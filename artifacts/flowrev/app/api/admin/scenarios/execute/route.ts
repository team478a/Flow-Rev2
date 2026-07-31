import { NextRequest, NextResponse } from "next/server";
import { getSessionProfile } from "@/features/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listPendingDueLogs,
  markLogSent,
  markLogFailed,
} from "@/lib/repositories/scenario-execution";
import { sendScenarioStepEmail } from "@/lib/email/send-scenario-step";
import { getLineSettingsResolved } from "@/lib/repositories/line-settings";
import { sendLinePushMessage } from "@/lib/line/client";

/**
 * POST /api/admin/scenarios/execute[?force=true]
 * シナリオの pending ログを処理してメール or LINE を送信する。
 * force=true のとき delay_days を無視して即時実行（テスト用）。
 *
 * client_owner は自テナント（自分の client_id）が所有するシナリオのログのみ実行できる。
 * system_admin は全テナントを対象に実行できる。それ以外のロール（customer 等）は 403。
 */
export async function POST(req: NextRequest) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "system_admin" && session.role !== "client_owner") {
    return NextResponse.json(
      { error: "この操作を行う権限がありません。" },
      { status: 403 },
    );
  }
  if (session.role === "client_owner" && !session.clientId) {
    return NextResponse.json(
      { error: "クライアント情報が見つかりません。" },
      { status: 400 },
    );
  }

  const force = req.nextUrl.searchParams.get("force") === "true";
  const scopeClientId = session.role === "client_owner" ? session.clientId! : undefined;

  let logs: Awaited<ReturnType<typeof listPendingDueLogs>>;
  try {
    logs = await listPendingDueLogs(force, scopeClientId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ログ取得に失敗しました。";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (logs.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      failed: 0,
      message: force
        ? "実行対象の pending ログがありません。"
        : "送信期日に達した pending ログがありません。",
    });
  }

  const admin = createAdminClient();
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const log of logs) {
    try {
      const { data: customer } = await admin
        .from("customers")
        .select("email, name, line_user_id, client_id")
        .eq("id", log.customerId)
        .maybeSingle();

      if (!customer) {
        await markLogFailed(log.logId, "顧客が見つかりません。");
        failed++;
        continue;
      }

      const c = customer as Record<string, unknown>;

      if (log.channel === "line") {
        const lineUserId = (c.line_user_id as string) ?? null;
        if (!lineUserId) {
          await markLogFailed(log.logId, "顧客の LINE ユーザー ID が設定されていません。");
          failed++;
          continue;
        }
        const clientId = c.client_id as string;
        const lineSettings = await getLineSettingsResolved(clientId).catch(() => null);
        if (!lineSettings?.channelAccessToken) {
          await markLogFailed(log.logId, "LINE チャネルアクセストークンが設定されていません。");
          failed++;
          continue;
        }
        await sendLinePushMessage(lineSettings.channelAccessToken, lineUserId, log.body);
      } else {
        await sendScenarioStepEmail({
          toEmail: c.email as string,
          subject: log.subject,
          body: log.body,
          whiteLabelId: log.whiteLabelId,
        });
      }

      await markLogSent(log.logId);
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      await markLogFailed(log.logId, msg);
      errors.push(msg);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, sent, failed, errors });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCloudflareSettingsResolved,
  updateCronTimestamps,
} from "@/lib/repositories/cloudflare-settings";
import { countUnprotectedVideos } from "@/lib/cloudflare/stream";
import { sendUnprotectedAlert } from "@/lib/email/send-unprotected-alert";
import { insertVideoCheckLog } from "@/lib/repositories/video-check-logs";
import { getSessionProfile } from "@/features/auth/session";

/**
 * GET /api/admin/cron/check-unprotected-videos  ← Vercel Cron はこちらを呼ぶ
 * POST /api/admin/cron/check-unprotected-videos ← 外部スケジューラ / 手動テスト用
 *
 * requireSignedURLs: false の動画が 1 件以上あれば通知メールを送る。
 * 送信先の優先順位:
 *   1. cloudflare_settings.alert_emails（管理画面で設定）
 *   2. system_admin 全員の auth メールアドレス（フォールバック）
 *
 * 認証: Authorization: Bearer <CRON_SECRET> ヘッダーで検証。
 * CRON_SECRET が未設定の場合、本番環境（NODE_ENV=production）ではリクエストを
 * 拒否する（フェイルクローズ）。開発環境では system_admin セッションへフォール
 * バックする（完全な認証なしでは絶対に処理しない）。
 *
 * Response: { ok: boolean; unprotected: number; total: number; notified: boolean; message?: string }
 */
export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET が未設定です。管理者に連絡してください。" },
        { status: 503 },
      );
    }
    // 開発環境のみ：CRON_SECRET 未設定でも system_admin セッションなら許可する
    const session = await getSessionProfile();
    if (!session || session.role !== "system_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    if (token !== secret) {
      const session = await getSessionProfile();
      if (!session || session.role !== "system_admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
  }

  const settings = await getCloudflareSettingsResolved().catch(() => null);
  if (!settings) {
    return NextResponse.json(
      {
        ok: false,
        message: "Cloudflare Stream が設定されていません。チェックをスキップします。",
      },
      { status: 200 },
    );
  }

  let countResult: { unprotected: number; total: number; videos: { id: string; title: string }[] };
  try {
    countResult = await countUnprotectedVideos(
      settings.accountId,
      settings.apiToken,
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : "動画カウントに失敗しました。",
      },
      { status: 502 },
    );
  }

  const nowIso = new Date().toISOString();

  if (countResult.unprotected === 0) {
    await Promise.all([
      updateCronTimestamps({
        lastCheckedAt: nowIso,
        lastUnprotectedCount: 0,
      }).catch(() => {}),
      insertVideoCheckLog({
        unprotected: 0,
        total: countResult.total,
        notified: false,
      }).catch(() => {}),
    ]);
    return NextResponse.json({
      ok: true,
      unprotected: 0,
      total: countResult.total,
      notified: false,
      message: "未保護動画はありません。",
    });
  }

  const toEmails = await resolveAlertEmails(settings.alertEmails ?? null);

  if (toEmails.length === 0) {
    await Promise.all([
      updateCronTimestamps({
        lastCheckedAt: nowIso,
        lastUnprotectedCount: countResult.unprotected,
      }).catch(() => {}),
      insertVideoCheckLog({
        unprotected: countResult.unprotected,
        total: countResult.total,
        notified: false,
      }).catch(() => {}),
    ]);
    return NextResponse.json(
      {
        ok: false,
        unprotected: countResult.unprotected,
        total: countResult.total,
        notified: false,
        message:
          "未保護動画が検出されましたが、通知先メールアドレスが見つかりませんでした。",
      },
      { status: 500 },
    );
  }

  const checkedAt = new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    undefined;

  try {
    await sendUnprotectedAlert({
      toEmails,
      unprotectedCount: countResult.unprotected,
      totalCount: countResult.total,
      checkedAt,
      videos: countResult.videos,
      appUrl,
    });
  } catch (e) {
    await Promise.all([
      updateCronTimestamps({
        lastCheckedAt: nowIso,
        lastUnprotectedCount: countResult.unprotected,
      }).catch(() => {}),
      insertVideoCheckLog({
        unprotected: countResult.unprotected,
        total: countResult.total,
        notified: false,
      }).catch(() => {}),
    ]);
    return NextResponse.json(
      {
        ok: false,
        unprotected: countResult.unprotected,
        total: countResult.total,
        notified: false,
        message: e instanceof Error ? e.message : "メール送信に失敗しました。",
      },
      { status: 500 },
    );
  }

  await Promise.all([
    updateCronTimestamps({
      lastCheckedAt: nowIso,
      lastAlertedAt: nowIso,
      lastUnprotectedCount: countResult.unprotected,
    }).catch(() => {}),
    insertVideoCheckLog({
      unprotected: countResult.unprotected,
      total: countResult.total,
      notified: true,
    }).catch(() => {}),
  ]);

  return NextResponse.json({
    ok: true,
    unprotected: countResult.unprotected,
    total: countResult.total,
    notified: true,
  });
}

/**
 * アラート通知先を解決する。
 * 1. cloudflare_settings.alert_emails が設定されていればそれを使う（カンマ区切りをパース）
 * 2. 未設定の場合は system_admin の auth メールアドレスにフォールバック
 */
async function resolveAlertEmails(
  configuredEmails: string | null,
): Promise<string[]> {
  if (configuredEmails && configuredEmails.trim()) {
    return configuredEmails
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
  }
  return getSystemAdminEmails();
}

/**
 * user_profiles から role = system_admin のユーザー ID を取得し、
 * auth.users からメールアドレスを引いて返す。
 */
async function getSystemAdminEmails(): Promise<string[]> {
  const admin = createAdminClient();

  const { data: profiles, error: profileError } = await admin
    .from("user_profiles")
    .select("id")
    .eq("role", "system_admin");

  if (profileError || !profiles || profiles.length === 0) return [];

  const emails: string[] = [];
  for (const profile of profiles) {
    const { data: userRes } = await admin.auth.admin.getUserById(
      profile.id as string,
    );
    const email = userRes?.user?.email;
    if (email) emails.push(email);
  }

  return emails;
}

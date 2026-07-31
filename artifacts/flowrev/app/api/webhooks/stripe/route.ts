import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeSettingsResolved } from "@/lib/repositories/stripe-settings";
import { markPurchasePaid } from "@/lib/repositories/purchases";
import { enqueuePurchaseScenarios } from "@/lib/repositories/scenario-execution";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe Webhook エンドポイント
 * 対応イベント: checkout.session.completed
 * 支払い完了 → purchase を paid 更新 → 招待メール送信 → シナリオエンキュー
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "署名がありません。" }, { status: 400 });
  }

  // metadata.client_id から Stripe 設定を取得するため先にペイロードを解析
  let eventData: Record<string, unknown>;
  try {
    eventData = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "不正なJSON。" }, { status: 400 });
  }

  const obj = (eventData.data as Record<string, unknown>)?.object as Record<string, unknown>;
  const metadata = (obj?.metadata as Record<string, string>) ?? {};
  const clientId = metadata.client_id;

  if (!clientId) {
    return NextResponse.json(
      { error: "client_id が metadata にありません。" },
      { status: 400 },
    );
  }

  // クライアントの Stripe 設定を取得して署名を検証
  const settings = await getStripeSettingsResolved(clientId).catch(() => null);
  if (!settings?.secretKey) {
    return NextResponse.json({ error: "Stripe 設定が見つかりません。" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripe = new Stripe(settings.secretKey, { apiVersion: "2026-05-27.dahlia" as any });

  if (!settings.webhookSecret) {
    // Webhook シークレット未設定のまま署名検証をスキップすると、リクエストボディを
    // 誰でも偽装できてしまう（不正な決済完了通知による無料アクセス権取得のリスク）。
    // 未設定の場合はイベントを拒否し、管理画面でのWebhookシークレット設定を必須とする。
    return NextResponse.json(
      { error: "Webhook シークレットが未設定です。管理画面で設定してください。" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, settings.webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "署名検証失敗";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const stripeSessionId = session.id;
  const whiteLabelId = metadata.white_label_id ?? null;
  const customerId = metadata.customer_id ?? null;
  const customerEmail = session.customer_email ?? metadata.customer_email ?? null;
  const customerName = metadata.customer_name ?? null;

  try {
    const admin = createAdminClient();

    // purchase を paid に更新
    await markPurchasePaid(stripeSessionId);

    // payment_logs に記録
    await admin.from("payment_logs").insert({
      client_id: clientId,
      white_label_id: whiteLabelId,
      purchase_id: null,
      provider: "stripe",
      event_type: event.type,
      raw_payload: { session_id: stripeSessionId, metadata },
      created_at: new Date().toISOString(),
    });

    // 顧客への招待メール送信（決済完了後にマイページへのアクセスを付与）
    if (customerEmail) {
      try {
        const host =
          req.headers.get("x-forwarded-host") ??
          req.headers.get("host") ??
          "localhost:3000";
        const proto = req.headers.get("x-forwarded-proto") ?? "http";
        const origin = `${proto}://${host}`;
        const redirectTo = `${origin}/auth/callback?next=/my`;

        const { data: inviteData, error: inviteError } =
          await admin.auth.admin.inviteUserByEmail(customerEmail, {
            redirectTo,
            data: { role: "customer" },
          });

        const authUserId = inviteData?.user?.id;
        if (authUserId) {
          await admin.from("user_profiles").upsert(
            {
              id: authUserId,
              role: "customer",
              display_name: customerName ?? null,
              client_id: clientId,
              white_label_id: whiteLabelId,
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
          await admin
            .from("customers")
            .update({ user_id: authUserId, updated_at: new Date().toISOString() })
            .eq("email", customerEmail)
            .eq("client_id", clientId);
        } else if (inviteError) {
          console.warn(
            `[Stripe Webhook] invite skipped for session ${stripeSessionId} (client ${clientId}): ${inviteError.message}`,
          );
        }
      } catch {
        // 招待失敗は webhook 成功に影響させない
      }
    }

    // シナリオエンキュー（ベストエフォート）
    if (customerId && whiteLabelId) {
      try {
        await enqueuePurchaseScenarios(customerId, clientId, whiteLabelId);
      } catch {
        // エンキュー失敗は webhook 成功に影響させない
      }
    }
  } catch (e) {
    console.error("[Stripe Webhook] 処理エラー:", e);
    return NextResponse.json({ error: "内部エラー" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

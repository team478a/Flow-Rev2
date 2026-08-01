import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { enqueuePurchaseScenarios } from "@/lib/repositories/scenario-execution";
import { getStripeClient } from "@/lib/stripe/client";
import { createPurchase } from "@/lib/repositories/purchases";
import Stripe from "stripe";

const bodySchema = z.object({
  lpId: z.string().uuid(),
  email: z.string().email("有効なメールアドレスを入力してください。"),
  name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? "入力が不正です。";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { lpId, email, name, phone } = parsed.data;
  const admin = createAdminClient();

  // LP を取得（slug / product_id / テナント情報）
  const { data: lpData } = await admin
    .from("landing_pages")
    .select("id, slug, client_id, white_label_id, conversions, status, product_id")
    .eq("id", lpId)
    .eq("status", "published")
    .maybeSingle();

  if (!lpData) {
    return NextResponse.json({ error: "LPが見つかりません。" }, { status: 404 });
  }

  const lp = lpData as Record<string, unknown>;
  const clientId = lp.client_id as string;
  const whiteLabelId = lp.white_label_id as string;
  const productId = lp.product_id as string | null;
  const currentConversions = (lp.conversions as number) ?? 0;

  // 顧客を upsert（email + client_id が既存の場合は更新しない）
  const { error: customerError } = await admin
    .from("customers")
    .upsert(
      {
        email,
        name: name ?? null,
        phone: phone ?? null,
        client_id: clientId,
        white_label_id: whiteLabelId,
        source: "lp",
        status: "active",
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email,client_id", ignoreDuplicates: true },
    );

  if (customerError) {
    return NextResponse.json(
      { error: "登録に失敗しました。しばらくしてからお試しください。" },
      { status: 500 },
    );
  }

  // 顧客 ID を取得
  const { data: customerRow } = await admin
    .from("customers")
    .select("id")
    .eq("email", email)
    .eq("client_id", clientId)
    .maybeSingle();
  const customerId = (customerRow as Record<string, unknown> | null)?.id as string | undefined;

  if (!customerId) {
    // 顧客IDが取得できない状態では、有料/無料どちらのフローも安全に進められない
    // （Stripe決済のmetadata・購入記録・招待・権限付与のいずれも顧客IDに依存するため）。
    // メールアドレス等のPIIはログに出さず、テナント・LPの識別子のみ記録する。
    console.error(
      `[LP register] 顧客ID取得失敗のため登録処理を停止 (client ${clientId}, lp ${lpId})`,
    );
    return NextResponse.json(
      { error: "登録に失敗しました。しばらくしてからお試しください。" },
      { status: 500 },
    );
  }

  // コンバージョンカウントを +1
  await admin
    .from("landing_pages")
    .update({ conversions: currentConversions + 1, updated_at: new Date().toISOString() })
    .eq("id", lpId);

  // ---- Stripe 決済フロー（商品に価格がある場合）----
  // price > 0 の場合、このブロックは必ず return する（成功時は checkoutUrl、
  // 失敗時は 502/503 エラー）。無料フローへフォールスルーすることはない。
  // 有料商品が設定不備や一時的なエラーで無料配布されてしまう事故を防ぐため。
  if (productId && customerId) {
    const { data: productData } = await admin
      .from("products")
      .select("id, name, price, price_type")
      .eq("id", productId)
      .maybeSingle();

    const product = productData as Record<string, unknown> | null;
    const price = (product?.price as number) ?? 0;

    if (price > 0) {
      const stripeResult = await getStripeClient(clientId).catch(() => null);

      if (!stripeResult) {
        // Stripe未設定（secretKeyが無い場合を含む）: 有料商品を無料で配布しないよう拒否する
        console.error(
          `[LP register] Stripe決済ブロック: Stripe未設定 (client ${clientId})`,
        );
        return NextResponse.json(
          { error: "現在この商品の決済を受け付けられません。しばらくしてからお試しください。" },
          { status: 503 },
        );
      }

      if (!stripeResult.webhookSecret) {
        // secretKeyのみ設定されwebhookSecretが未設定のまま Checkout を作成すると、
        // Webhook側（app/api/webhooks/stripe/route.ts）は決済完了イベントを検証できず
        // 拒否するため、顧客は課金されるのに購入確定・アクセス権付与が永久に行われない。
        console.error(
          `[LP register] Stripe決済ブロック: webhookSecret未設定 (client ${clientId})`,
        );
        return NextResponse.json(
          { error: "現在この商品の決済を受け付けられません。しばらくしてからお試しください。" },
          { status: 503 },
        );
      }

      try {
        const host =
          req.headers.get("x-forwarded-host") ??
          req.headers.get("host") ??
          "localhost:3000";
        const proto = req.headers.get("x-forwarded-proto") ?? "http";
        const origin = `${proto}://${host}`;
        const lpSlug = (lp.slug as string) ?? lpId;

        const session = await stripeResult.stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "jpy",
                unit_amount: price,
                product_data: { name: (product?.name as string) ?? "商品" },
              },
            },
          ],
          success_url: `${origin}/my?payment=success`,
          cancel_url: `${origin}/p/${lpSlug}`,
          customer_email: email,
          metadata: {
            client_id: clientId,
            white_label_id: whiteLabelId,
            customer_id: customerId,
            product_id: productId,
            lp_id: lpId,
            customer_name: name ?? "",
            customer_email: email,
          },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // pending 購入レコードを作成
        await createPurchase({
          clientId,
          whiteLabelId,
          customerId,
          productId,
          amount: price,
          stripeSessionId: session.id,
        }).catch(() => null);

        return NextResponse.json({ ok: true, checkoutUrl: session.url });
      } catch (e) {
        // 秘密情報はログへ出さない（Stripeエラーオブジェクトはメッセージのみ）
        const msg = e instanceof Error ? e.message : "unknown error";
        console.error(
          `[LP register] Stripe Checkout 作成失敗 (client ${clientId}): ${msg}`,
        );
        return NextResponse.json(
          { error: "決済の準備に失敗しました。しばらくしてからお試しください。" },
          { status: 502 },
        );
      }
    }
  }

  // ---- 無料フロー（商品が無い、または価格が0以下の場合のみ）----
  try {
    const host =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    const origin = `${proto}://${host}`;
    const redirectTo = `${origin}/auth/callback?next=/my`;

    const { data: inviteData, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { role: "customer" },
      });

    const authUserId = inviteData?.user?.id;
    if (authUserId) {
      await admin.from("user_profiles").upsert(
        {
          id: authUserId,
          role: "customer",
          display_name: name ?? null,
          client_id: clientId,
          white_label_id: whiteLabelId,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
      await admin
        .from("customers")
        .update({ user_id: authUserId, updated_at: new Date().toISOString() })
        .eq("email", email)
        .eq("client_id", clientId);
    } else if (inviteError) {
      console.warn(
        `[LP register] invite skipped for lp ${lpId} (client ${clientId}): ${inviteError.message}`,
      );
    }
  } catch {
    // 招待エラーは登録成功に影響させない
  }

  // シナリオエンキュー（ベストエフォート）
  if (customerId) {
    try {
      await enqueuePurchaseScenarios(customerId, clientId, whiteLabelId);
    } catch {
      // エンキュー失敗は登録成功に影響させない
    }
  }

  return NextResponse.json({ ok: true });
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";

/**
 * Stripe Webhook の署名検証と、検証を通過した後の処理の検証。
 *
 * このエンドポイントは「支払いが完了した」という主張を外部から受け取り、
 * それを信じて商品アクセス権を付与する。署名検証が緩むと、誰でも偽の
 * 決済完了通知を投げて無料でアクセス権を取得できてしまうため、
 * 異常系こそ落とせないことを確認する。
 *
 * `stripe.webhooks.constructEvent()` はモックしない。検証ロジック自体が
 * 検証対象なので、Stripe SDK の generateTestHeaderString() で本物の署名を作り、
 * 実際に検証を通す（あるいは通らないことを確かめる）。
 */

const WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";
const OTHER_SECRET = "whsec_a_different_secret";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const WL_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "cs_test_123";

const markPurchasePaid = vi.fn();
const inviteCustomerWithTenant = vi.fn(async (_input: unknown) => ({
  authUserId: "user-1" as string | null,
  error: null as string | null,
}));
const enqueuePurchaseScenarios = vi.fn();
const insert = vi.fn(async () => ({ error: null }));

let resolvedSettings: {
  secretKey: string;
  webhookSecret: string | null;
  isLive: boolean;
  tier: string;
} | null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}));
vi.mock("@/lib/repositories/stripe-settings", () => ({
  getStripeSettingsResolved: async () => resolvedSettings,
}));
vi.mock("@/lib/repositories/purchases", () => ({
  markPurchasePaid: (...args: unknown[]) => markPurchasePaid(...args),
}));
vi.mock("@/lib/repositories/scenario-execution", () => ({
  enqueuePurchaseScenarios: (...args: unknown[]) =>
    enqueuePurchaseScenarios(...args),
}));
vi.mock("@/lib/repositories/customer-onboarding", () => ({
  inviteCustomerWithTenant: (input: unknown) => inviteCustomerWithTenant(input),
}));

const stripe = new Stripe("sk_test_dummy", {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiVersion: "2026-05-27.dahlia" as any,
});

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test",
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        customer_email: "buyer@example.com",
        metadata: {
          client_id: CLIENT_ID,
          white_label_id: WL_ID,
          customer_id: "cus-1",
          customer_name: "購入者",
          customer_email: "buyer@example.com",
        },
      },
    },
    ...overrides,
  };
}

/** 指定シークレットで正しく署名したリクエストを作る */
function buildRequest(body: string, secret: string | null) {
  const headers: Record<string, string> = { host: "example.com" };
  if (secret) {
    headers["stripe-signature"] = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    });
  }
  return new NextRequest("https://example.com/api/webhooks/stripe", {
    method: "POST",
    body,
    headers,
  });
}

async function callWebhook(body: string, secret: string | null) {
  const { POST } = await import("./route");
  return POST(buildRequest(body, secret));
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvedSettings = {
    secretKey: "sk_test_dummy",
    webhookSecret: WEBHOOK_SECRET,
    isLive: false,
    tier: "white_label",
  };
});

describe("Stripe Webhook の署名検証", () => {
  it("正しい署名なら決済完了として処理する", async () => {
    const body = JSON.stringify(buildEvent());
    const res = await callWebhook(body, WEBHOOK_SECRET);

    expect(res.status).toBe(200);
    expect(markPurchasePaid).toHaveBeenCalledWith(SESSION_ID);
  });

  it("別のシークレットで署名されたリクエストを拒否する", async () => {
    const body = JSON.stringify(buildEvent());
    const res = await callWebhook(body, OTHER_SECRET);

    expect(res.status).toBe(400);
    // 支払い済みにしてしまうと、偽の通知で商品アクセス権が渡る
    expect(markPurchasePaid).not.toHaveBeenCalled();
  });

  it("署名後に本文が改ざんされたリクエストを拒否する", async () => {
    const body = JSON.stringify(buildEvent());
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });
    const tampered = body.replace(SESSION_ID, "cs_test_attacker");

    const { POST } = await import("./route");
    const res = await POST(
      new NextRequest("https://example.com/api/webhooks/stripe", {
        method: "POST",
        body: tampered,
        headers: { host: "example.com", "stripe-signature": signature },
      }),
    );

    expect(res.status).toBe(400);
    expect(markPurchasePaid).not.toHaveBeenCalled();
  });

  it("stripe-signature ヘッダが無いリクエストを拒否する", async () => {
    const res = await callWebhook(JSON.stringify(buildEvent()), null);

    expect(res.status).toBe(400);
    expect(markPurchasePaid).not.toHaveBeenCalled();
  });

  it("Webhookシークレット未設定なら、署名が正しくても処理しない", async () => {
    // 未設定のまま検証をスキップすると本文を誰でも偽装できるため、
    // 実装は fail closed で拒否する（PR #5 の修正）。
    resolvedSettings = {
      secretKey: "sk_test_dummy",
      webhookSecret: null,
      isLive: false,
      tier: "white_label",
    };
    const body = JSON.stringify(buildEvent());
    const res = await callWebhook(body, WEBHOOK_SECRET);

    expect(res.status).toBe(400);
    expect(markPurchasePaid).not.toHaveBeenCalled();

    // 明示的なガードで弾いていることまで確認する。
    // ガードを外しても constructEvent() が null シークレットで例外を投げるため
    // ステータスだけ見ると 400 のままで、ガードの有無を区別できない。
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("Webhook シークレットが未設定");
  });

  it("metadata.client_id が無いリクエストを拒否する", async () => {
    // client_id はどのテナントの鍵で検証するかを決める。
    // 欠けたまま進むと、検証に使う鍵を決められない。
    const event = buildEvent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event.data.object as any).metadata = { customer_email: "x@example.com" };
    const body = JSON.stringify(event);

    const res = await callWebhook(body, WEBHOOK_SECRET);

    expect(res.status).toBe(400);
    expect(markPurchasePaid).not.toHaveBeenCalled();
  });

  it("Stripe設定が見つからないテナントのイベントを拒否する", async () => {
    resolvedSettings = null;
    const res = await callWebhook(JSON.stringify(buildEvent()), WEBHOOK_SECRET);

    expect(res.status).toBe(400);
    expect(markPurchasePaid).not.toHaveBeenCalled();
  });
});

describe("検証通過後の処理", () => {
  it("checkout.session.completed 以外は受理するが何もしない", async () => {
    const body = JSON.stringify(
      buildEvent({ type: "payment_intent.succeeded" }),
    );
    const res = await callWebhook(body, WEBHOOK_SECRET);

    expect(res.status).toBe(200);
    expect(markPurchasePaid).not.toHaveBeenCalled();
  });

  it("招待にテナント情報を渡す", async () => {
    // client_id を渡し損ねると、購入者の user_profiles.client_id が NULL になり
    // /my に入れなくなる（PR #15 で修正した不具合の再発防止）。
    const body = JSON.stringify(buildEvent());
    await callWebhook(body, WEBHOOK_SECRET);

    expect(inviteCustomerWithTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "buyer@example.com",
        clientId: CLIENT_ID,
        whiteLabelId: WL_ID,
      }),
    );
  });
});

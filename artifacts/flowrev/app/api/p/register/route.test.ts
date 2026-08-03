import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type Row } from "@/test/helpers/fake-supabase";

/**
 * 公開LPの登録エンドポイントの検証。
 *
 * ここは有料購入と無料登録の分岐点で、2つの性質の違う失敗がある。
 *  - 無料登録でテナントを付け損ねる → 登録者が /my に入れない
 *  - 有料商品をStripe未設定のまま通す → 課金されないまま商品が配布される
 *
 * 後者は「決済に失敗したら無料で通す」というフォールスルーとして
 * 混入しやすく、正常系のテストでは絶対に検出できない。
 */

const LP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const WL_ID = "22222222-2222-2222-2222-222222222222";
const PRODUCT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

let fake: ReturnType<typeof createFakeSupabase>;
let stripeResult: { webhookSecret?: string | null } | null;

const inviteCustomerWithTenant = vi.fn(async (_input: unknown) => ({
  authUserId: "invited-user",
  error: null as string | null,
}));
const createPurchase = vi.fn(async (_input: unknown) => undefined);
const enqueuePurchaseScenarios = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fake,
}));
vi.mock("@/lib/repositories/customer-onboarding", () => ({
  inviteCustomerWithTenant: (input: unknown) => inviteCustomerWithTenant(input),
}));
vi.mock("@/lib/repositories/purchases", () => ({
  createPurchase: (input: unknown) => createPurchase(input),
}));
vi.mock("@/lib/repositories/scenario-execution", () => ({
  enqueuePurchaseScenarios: (...args: unknown[]) =>
    enqueuePurchaseScenarios(...(args as [])),
}));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: async () => stripeResult,
}));

function setup(productPrice: number | null) {
  const tables: Record<string, Row[]> = {
    landing_pages: [
      {
        id: LP_ID,
        slug: "lp-test",
        client_id: CLIENT_ID,
        white_label_id: WL_ID,
        conversions: 0,
        status: "published",
        product_id: productPrice === null ? null : PRODUCT_ID,
      },
    ],
    customers: [
      { id: CUSTOMER_ID, email: "buyer@example.com", client_id: CLIENT_ID },
    ],
    products:
      productPrice === null
        ? []
        : [
            {
              id: PRODUCT_ID,
              name: "テスト商品",
              price: productPrice,
              price_type: "one_time",
            },
          ],
  };
  fake = createFakeSupabase(tables);
}

async function register() {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("https://app.example.com/api/p/register", {
      method: "POST",
      body: JSON.stringify({
        lpId: LP_ID,
        email: "buyer@example.com",
        name: "登録者",
      }),
      headers: { "content-type": "application/json", host: "app.example.com" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  stripeResult = { webhookSecret: "whsec_x" };
});

describe("無料登録", () => {
  it("価格0の商品ならCheckoutを作らず登録を完了する", async () => {
    setup(0);

    const res = await register();

    expect(res.status).toBe(200);
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("商品が紐付いていないLPでも登録を完了する", async () => {
    setup(null);

    const res = await register();

    expect(res.status).toBe(200);
  });

  it("招待にテナント情報を渡す", async () => {
    // 有料購入と同じ inviteCustomerWithTenant を通すことで、
    // 無料登録者にも client_id / white_label_id が設定される。
    // ここが欠けると登録者は /my に入れない。
    setup(0);

    await register();

    expect(inviteCustomerWithTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "buyer@example.com",
        clientId: CLIENT_ID,
        whiteLabelId: WL_ID,
      }),
    );
  });
});

describe("有料商品のfail closed", () => {
  it("Stripe未設定ならCheckoutを作らず拒否する", async () => {
    // ここで無料フローへ流れると、課金されないまま商品が配布される
    setup(1000);
    stripeResult = null;

    const res = await register();

    expect(res.status).toBe(503);
    expect(inviteCustomerWithTenant).not.toHaveBeenCalled();
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("Webhookシークレット未設定なら拒否する", async () => {
    // secretKeyだけでCheckoutを作ると、決済は成立するのに
    // Webhookが検証できず購入確定が永久に行われない。
    setup(1000);
    stripeResult = { webhookSecret: null };

    const res = await register();

    expect(res.status).toBe(503);
    expect(inviteCustomerWithTenant).not.toHaveBeenCalled();
    expect(createPurchase).not.toHaveBeenCalled();
  });
});

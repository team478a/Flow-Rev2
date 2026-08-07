import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type Row } from "@/test/helpers/fake-supabase";

/**
 * 購入済み商品の列挙の検証。
 *
 * この結果がコース一覧の表示可否をそのまま決める。多く返せば購入していない
 * コースが見え、少なく返せば購入した顧客が自分のコースを見られない。
 * どちらも「画面は正常に動いている」ようにしか見えない。
 */

const CUSTOMER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OTHER_CUSTOMER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT_ID = "99999999-9999-9999-9999-999999999999";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fake,
}));

function setup(rows: Row[]) {
  fake = createFakeSupabase({ purchases: rows });
}

async function list() {
  const { listPurchasedProductIds } = await import("./purchases");
  return listPurchasedProductIds(CUSTOMER_ID, CLIENT_ID);
}

beforeEach(() => vi.resetModules());

describe("購入済み商品の列挙", () => {
  it("支払い済みの商品IDを返す", async () => {
    setup([
      {
        id: "1",
        customer_id: CUSTOMER_ID,
        client_id: CLIENT_ID,
        product_id: "product-a",
        payment_status: "paid",
      },
    ]);

    expect(await list()).toEqual(["product-a"]);
  });

  it("未払いの購入は含めない", async () => {
    // Checkout を開いただけで離脱すると pending の行が残る。
    // これを通すと、決済せずにコースが見られる。
    setup([
      {
        id: "1",
        customer_id: CUSTOMER_ID,
        client_id: CLIENT_ID,
        product_id: "product-a",
        payment_status: "pending",
      },
    ]);

    expect(await list()).toEqual([]);
  });

  it("他の顧客の購入を含めない", async () => {
    setup([
      {
        id: "1",
        customer_id: OTHER_CUSTOMER_ID,
        client_id: CLIENT_ID,
        product_id: "product-a",
        payment_status: "paid",
      },
    ]);

    expect(await list()).toEqual([]);
  });

  it("他クライアントの購入を含めない", async () => {
    // customer_id は本来クライアントに閉じているが、
    // 権限判定を1つの条件だけに依存させない。
    setup([
      {
        id: "1",
        customer_id: CUSTOMER_ID,
        client_id: OTHER_CLIENT_ID,
        product_id: "product-a",
        payment_status: "paid",
      },
    ]);

    expect(await list()).toEqual([]);
  });

  it("product_id が無い購入は除外する", async () => {
    // 商品紐付けの無い購入行が混ざっても、undefined が集合に入らないようにする。
    setup([
      {
        id: "1",
        customer_id: CUSTOMER_ID,
        client_id: CLIENT_ID,
        product_id: null,
        payment_status: "paid",
      },
    ]);

    expect(await list()).toEqual([]);
  });
});

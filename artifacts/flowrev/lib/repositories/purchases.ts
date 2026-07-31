import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface CreatePurchaseInput {
  clientId: string;
  whiteLabelId: string;
  customerId: string;
  productId: string;
  amount: number;
  currency?: string;
  stripeSessionId?: string;
}

export type PurchaseRow = {
  id: string;
  product_id: string | null;
  amount: number;
  currency: string;
  payment_status: string;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
};

/** 購入レコードを作成して ID を返す */
export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchases")
    .insert({
      client_id: input.clientId,
      white_label_id: input.whiteLabelId,
      customer_id: input.customerId,
      product_id: input.productId,
      amount: input.amount,
      currency: input.currency ?? "jpy",
      payment_method: "stripe",
      payment_status: "pending",
      stripe_session_id: input.stripeSessionId ?? null,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throwSafe("購入記録の作成に失敗", error);
  return (data as Record<string, unknown>).id as string;
}

/** Stripe Session ID を使って purchase を paid に更新する */
export async function markPurchasePaid(
  stripeSessionId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("purchases")
    .update({
      payment_status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("stripe_session_id", stripeSessionId)
    .eq("payment_status", "pending");

  if (error) throwSafe("購入ステータスの更新に失敗", error);
}

/** 指定顧客が paid 購入を持っているか確認する */
export async function hasPaidPurchase(
  customerId: string,
  clientId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchases")
    .select("id")
    .eq("customer_id", customerId)
    .eq("client_id", clientId)
    .eq("payment_status", "paid")
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

/** 指定顧客が特定プロダクトの paid 購入を持っているか確認する */
export async function hasPurchasedProduct(
  customerId: string,
  productId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchases")
    .select("id")
    .eq("customer_id", customerId)
    .eq("product_id", productId)
    .eq("payment_status", "paid")
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

/** 顧客の購入履歴一覧を返す */
export async function getPurchasesByCustomer(
  customerId: string,
  clientId: string,
): Promise<PurchaseRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchases")
    .select(
      "id, product_id, amount, currency, payment_status, payment_method, paid_at, created_at",
    )
    .eq("customer_id", customerId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throwSafe("購入履歴の取得に失敗", error);
  return (data ?? []) as PurchaseRow[];
}

export interface PurchaseListItem {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  productName: string | null;
  amount: number;
  currency: string;
  paymentStatus: string;
  paidAt: string | null;
  createdAt: string;
}

/** client_owner 向け：購入履歴一覧（顧客名・商品名付き） */
export async function getPurchasesForClient(
  clientId: string,
): Promise<PurchaseListItem[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("purchases")
    .select("id, amount, currency, payment_status, paid_at, created_at, customer_id, product_id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) throwSafe("購入履歴の取得に失敗", error);
  const rows = (data ?? []) as Record<string, unknown>[];

  const customerIds = [...new Set(rows.map((r) => r.customer_id as string).filter(Boolean))];
  const productIds = [...new Set(rows.map((r) => r.product_id as string).filter(Boolean))];

  const [{ data: customers }, { data: products }] = await Promise.all([
    customerIds.length > 0
      ? admin.from("customers").select("id, name, email").in("id", customerIds)
      : Promise.resolve({ data: [] }),
    productIds.length > 0
      ? admin.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] }),
  ]);

  const customerMap = new Map(
    ((customers ?? []) as Record<string, unknown>[]).map((c) => [c.id as string, c]),
  );
  const productMap = new Map(
    ((products ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]),
  );

  return rows.map((r) => {
    const customer = customerMap.get(r.customer_id as string);
    const product = productMap.get(r.product_id as string);
    return {
      id: r.id as string,
      customerName: (customer?.name as string) ?? null,
      customerEmail: (customer?.email as string) ?? null,
      productName: (product?.name as string) ?? null,
      amount: r.amount as number,
      currency: (r.currency as string) ?? "jpy",
      paymentStatus: (r.payment_status as string) ?? "pending",
      paidAt: (r.paid_at as string) ?? null,
      createdAt: r.created_at as string,
    };
  });
}

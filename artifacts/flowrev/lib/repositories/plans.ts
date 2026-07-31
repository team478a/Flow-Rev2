import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface PlanOption {
  id: string;
  name: string;
  priceMonthly: number;
}

export interface PlanRow {
  id: string;
  name: string;
  maxClients: number;
  maxProducts: number;
  maxCustomers: number;
  priceMonthly: number;
  features: Record<string, boolean>;
  createdAt: string | null;
}

export interface CreatePlanInput {
  name: string;
  maxClients: number;
  maxProducts: number;
  maxCustomers: number;
  priceMonthly: number;
  features?: Record<string, boolean>;
}

/**
 * プラン一覧を取得する（管理者クライアント）。
 * ホワイトラベル作成フォームの選択肢用。プラン未登録なら空配列を返す。
 */
export async function listPlans(): Promise<PlanOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plans")
    .select("id, name, price_monthly")
    .order("price_monthly", { ascending: true });

  if (error) {
    throwSafe("プランの取得に失敗しました", error);
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    priceMonthly: (p.price_monthly as number) ?? 0,
  }));
}

/**
 * プラン一覧を詳細項目つきで取得する（管理画面の一覧表示用）。
 */
export async function listPlansFull(): Promise<PlanRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plans")
    .select(
      "id, name, max_clients, max_products, max_customers, price_monthly, features, created_at",
    )
    .order("price_monthly", { ascending: true });

  if (error) {
    throwSafe("プランの取得に失敗しました", error);
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    maxClients: (p.max_clients as number) ?? 0,
    maxProducts: (p.max_products as number) ?? 0,
    maxCustomers: (p.max_customers as number) ?? 0,
    priceMonthly: (p.price_monthly as number) ?? 0,
    features: ((p.features as Record<string, boolean>) ?? {}),
    createdAt: (p.created_at as string) ?? null,
  }));
}

/**
 * WL オーナー自身のプラン一覧を取得する。
 */
export async function listWLPlans(whiteLabelId: string): Promise<PlanOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plans")
    .select("id, name, price_monthly")
    .eq("white_label_id", whiteLabelId)
    .order("price_monthly", { ascending: true });

  if (error) {
    throwSafe("プランの取得に失敗しました", error);
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    priceMonthly: (p.price_monthly as number) ?? 0,
  }));
}

/**
 * WL オーナー自身のプラン一覧を詳細項目つきで取得する（一覧表示用）。
 */
export async function listWLPlansFull(whiteLabelId: string): Promise<PlanRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plans")
    .select("id, name, max_clients, max_products, max_customers, price_monthly, features, created_at")
    .eq("white_label_id", whiteLabelId)
    .order("price_monthly", { ascending: true });

  if (error) {
    throwSafe("プランの取得に失敗しました", error);
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    maxClients: (p.max_clients as number) ?? 0,
    maxProducts: (p.max_products as number) ?? 0,
    maxCustomers: (p.max_customers as number) ?? 0,
    priceMonthly: (p.price_monthly as number) ?? 0,
    features: ((p.features as Record<string, boolean>) ?? {}),
    createdAt: (p.created_at as string) ?? null,
  }));
}

/**
 * WL オーナー用プランを作成する（white_label_id を紐付け）。
 */
export async function createWLPlan(
  whiteLabelId: string,
  input: CreatePlanInput,
): Promise<{ id: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plans")
    .insert({
      name: input.name,
      max_clients: input.maxClients,
      max_products: input.maxProducts,
      max_customers: input.maxCustomers,
      price_monthly: input.priceMonthly,
      features: input.features ?? {},
      white_label_id: whiteLabelId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throwSafe("プランの作成に失敗しました", error);
  }

  return { id: data.id as string };
}

/**
 * WL プラン1件を取得する（管理者クライアント）。
 */
export async function getWLPlan(
  id: string,
  whiteLabelId: string,
): Promise<PlanRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plans")
    .select("id, name, max_clients, max_products, max_customers, price_monthly, features, created_at")
    .eq("id", id)
    .eq("white_label_id", whiteLabelId)
    .maybeSingle();

  if (error) throwSafe("取得に失敗しました", error);
  if (!data) return null;

  return {
    id: data.id as string,
    name: data.name as string,
    maxClients: (data.max_clients as number) ?? 0,
    maxProducts: (data.max_products as number) ?? 0,
    maxCustomers: (data.max_customers as number) ?? 0,
    priceMonthly: (data.price_monthly as number) ?? 0,
    features: ((data.features as Record<string, boolean>) ?? {}),
    createdAt: (data.created_at as string) ?? null,
  };
}

/**
 * WL プランを更新する（管理者クライアント）。
 */
export async function updateWLPlan(
  id: string,
  whiteLabelId: string,
  input: CreatePlanInput,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("plans")
    .update({
      name: input.name,
      max_clients: input.maxClients,
      max_products: input.maxProducts,
      max_customers: input.maxCustomers,
      price_monthly: input.priceMonthly,
      features: input.features ?? {},
    })
    .eq("id", id)
    .eq("white_label_id", whiteLabelId);

  if (error) throwSafe("更新に失敗しました", error);
}

/**
 * WL プランを削除する（管理者クライアント）。
 */
export async function deleteWLPlan(
  id: string,
  whiteLabelId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("plans")
    .delete()
    .eq("id", id)
    .eq("white_label_id", whiteLabelId);

  if (error) throwSafe("削除に失敗しました", error);
}

/**
 * プランを作成する（管理者クライアント）。
 */
export async function createPlan(
  input: CreatePlanInput,
): Promise<{ id: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plans")
    .insert({
      name: input.name,
      max_clients: input.maxClients,
      max_products: input.maxProducts,
      max_customers: input.maxCustomers,
      price_monthly: input.priceMonthly,
    })
    .select("id")
    .single();

  if (error || !data) {
    throwSafe("プランの作成に失敗しました", error);
  }

  return { id: data.id as string };
}

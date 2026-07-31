import { createClient } from "@/lib/supabase/server";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  priceType: string;
  recurringInterval: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  status: string;
  aiGenerated: boolean;
  clientId: string;
  whiteLabelId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  name: string;
  description?: string;
  price: number;
  priceType: string;
  recurringInterval?: string;
  category?: string;
  status: string;
  clientId: string;
  whiteLabelId: string;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  price?: number;
  priceType?: string;
  recurringInterval?: string;
  thumbnailUrl?: string;
  category?: string;
  status?: string;
}

function mapRow(r: Record<string, unknown>): ProductRow {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    price: r.price as number,
    priceType: (r.price_type as string) ?? "one_time",
    recurringInterval: (r.recurring_interval as string) ?? null,
    thumbnailUrl: (r.thumbnail_url as string) ?? null,
    category: (r.category as string) ?? null,
    status: r.status as string,
    aiGenerated: (r.ai_generated as boolean) ?? false,
    clientId: r.client_id as string,
    whiteLabelId: r.white_label_id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/**
 * クライアント配下の商品一覧を取得する（新しい順）。RLS で自テナントのみ。
 */
export async function listProducts(): Promise<ProductRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, description, price, price_type, recurring_interval, thumbnail_url, category, status, ai_generated, client_id, white_label_id, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (error) throwSafe("商品一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/**
 * 商品を1件取得する。RLS で自テナントのみアクセス可能。
 */
export async function getProduct(id: string): Promise<ProductRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, description, price, price_type, recurring_interval, thumbnail_url, category, status, ai_generated, client_id, white_label_id, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throwSafe("商品の取得に失敗しました", error);
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

/**
 * 商品を作成する。client_id / white_label_id はセッションから渡す（RLS WITH CHECK で二重検証）。
 */
export async function createProduct(
  input: CreateProductInput,
): Promise<ProductRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      price_type: input.priceType,
      recurring_interval: input.recurringInterval ?? null,
      category: input.category ?? null,
      status: input.status,
      client_id: input.clientId,
      white_label_id: input.whiteLabelId,
    })
    .select(
      "id, name, description, price, price_type, recurring_interval, thumbnail_url, category, status, ai_generated, client_id, white_label_id, created_at, updated_at",
    )
    .single();

  if (error || !data)
    throwSafe("商品の作成に失敗しました", error);
  return mapRow(data as Record<string, unknown>);
}

/**
 * 商品を更新する。RLS USING 句により自テナント以外は 0行更新になる。
 */
export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.price !== undefined && { price: input.price }),
      ...(input.priceType !== undefined && { price_type: input.priceType }),
      ...(input.recurringInterval !== undefined && {
        recurring_interval: input.recurringInterval,
      }),
      ...(input.thumbnailUrl !== undefined && { thumbnail_url: input.thumbnailUrl }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.status !== undefined && { status: input.status }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(
      "id, name, description, price, price_type, recurring_interval, thumbnail_url, category, status, ai_generated, client_id, white_label_id, created_at, updated_at",
    )
    .single();

  if (error || !data)
    throwSafe("商品の更新に失敗しました", error);
  return mapRow(data as Record<string, unknown>);
}

/**
 * 商品を削除する。RLS USING 句により自テナント以外は削除不可。
 */
export async function deleteProduct(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throwSafe("商品の削除に失敗しました", error);
}

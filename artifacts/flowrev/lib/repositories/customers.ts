import { createClient } from "@/lib/supabase/server";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface CustomerRow {
  id: string;
  whiteLabelId: string;
  clientId: string;
  userId: string | null;
  email: string;
  name: string | null;
  phone: string | null;
  source: string;
  status: string;
  tags: string[];
  notes: string | null;
  lastActionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  whiteLabelId: string;
  clientId: string;
  email: string;
  name?: string;
  phone?: string;
  source: string;
  status: string;
  tags: string[];
  notes?: string;
}

export interface UpdateCustomerInput {
  email?: string;
  name?: string | null;
  phone?: string | null;
  source?: string;
  status?: string;
  tags?: string[];
  notes?: string | null;
  lastActionAt?: string | null;
}

const COLS =
  "id, white_label_id, client_id, user_id, email, name, phone, source, status, tags, notes, last_action_at, created_at, updated_at";

function mapRow(r: Record<string, unknown>): CustomerRow {
  return {
    id: r.id as string,
    whiteLabelId: r.white_label_id as string,
    clientId: r.client_id as string,
    userId: (r.user_id as string) ?? null,
    email: r.email as string,
    name: (r.name as string) ?? null,
    phone: (r.phone as string) ?? null,
    source: (r.source as string) ?? "manual",
    status: r.status as string,
    tags: (r.tags as string[]) ?? [],
    notes: (r.notes as string) ?? null,
    lastActionAt: (r.last_action_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** 顧客一覧（新しい順）。RLS で自テナントのみ。 */
export async function listCustomers(): Promise<CustomerRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(COLS)
    .order("created_at", { ascending: false });

  if (error) throwSafe("顧客一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** 顧客1件取得。RLS で自テナントのみ。 */
export async function getCustomer(id: string): Promise<CustomerRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) throwSafe("顧客の取得に失敗しました", error);
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

/** 顧客作成。client_id / white_label_id はセッションから渡す。 */
export async function createCustomer(
  input: CreateCustomerInput,
): Promise<CustomerRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      white_label_id: input.whiteLabelId,
      client_id: input.clientId,
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      source: input.source,
      status: input.status,
      tags: input.tags,
      notes: input.notes ?? null,
    })
    .select(COLS)
    .single();

  if (error || !data)
    throwSafe("顧客の作成に失敗しました", error);
  return mapRow(data as Record<string, unknown>);
}

/** 顧客更新。RLS USING 句で自テナントのみ更新可能。 */
export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({
      ...(input.email !== undefined && { email: input.email }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.source !== undefined && { source: input.source }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.lastActionAt !== undefined && {
        last_action_at: input.lastActionAt,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(COLS)
    .single();

  if (error || !data)
    throwSafe("顧客の更新に失敗しました", error);
  return mapRow(data as Record<string, unknown>);
}

/** 顧客削除。RLS USING 句で自テナントのみ削除可能。 */
export async function deleteCustomer(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) throwSafe("顧客の削除に失敗しました", error);
}

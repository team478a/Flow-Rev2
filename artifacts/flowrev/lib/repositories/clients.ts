import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface ClientRow {
  id: string;
  businessName: string;
  status: string;
  whiteLabelId: string;
  ownerUserId: string | null;
  createdAt: string | null;
}

export interface CreateClientInput {
  whiteLabelId: string;
  ownerUserId: string;
  businessName: string;
  planId?: string | null;
}

/**
 * client_id からステータスのみを取得する（ガードでのチェック用）。
 * 存在しない場合は null を返す。
 */
export async function getClientStatusById(clientId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clients")
    .select("status")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return null;
  return (data?.status as string) ?? null;
}

/**
 * WL オーナー配下のクライアント一覧を取得する（管理者クライアント）。
 */
export async function listClientsForWL(whiteLabelId: string): Promise<ClientRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id, business_name, status, white_label_id, owner_user_id, created_at")
    .eq("white_label_id", whiteLabelId)
    .order("created_at", { ascending: false });

  if (error) throwSafe("クライアント一覧の取得に失敗しました", error);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    businessName: r.business_name as string,
    status: r.status as string,
    whiteLabelId: r.white_label_id as string,
    ownerUserId: (r.owner_user_id as string) ?? null,
    createdAt: (r.created_at as string) ?? null,
  }));
}

/**
 * クライアント1件を取得する（管理者クライアント）。
 */
export async function getClient(id: string, whiteLabelId: string): Promise<ClientRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id, business_name, status, white_label_id, owner_user_id, created_at")
    .eq("id", id)
    .eq("white_label_id", whiteLabelId)
    .maybeSingle();

  if (error) throwSafe("取得に失敗しました", error);
  if (!data) return null;

  return {
    id: data.id as string,
    businessName: data.business_name as string,
    status: data.status as string,
    whiteLabelId: data.white_label_id as string,
    ownerUserId: (data.owner_user_id as string) ?? null,
    createdAt: (data.created_at as string) ?? null,
  };
}

/**
 * クライアントの事業者名を更新する（管理者クライアント）。
 */
export async function updateClient(
  id: string,
  whiteLabelId: string,
  input: { businessName: string },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("clients")
    .update({ business_name: input.businessName })
    .eq("id", id)
    .eq("white_label_id", whiteLabelId);

  if (error) throwSafe("更新に失敗しました", error);
}

/**
 * クライアントのステータスを切り替える（active ↔ suspended）。
 */
export async function toggleClientStatus(
  id: string,
  whiteLabelId: string,
  status: "active" | "suspended",
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("clients")
    .update({ status })
    .eq("id", id)
    .eq("white_label_id", whiteLabelId);

  if (error) throwSafe("ステータス変更に失敗しました", error);
}

/**
 * クライアント（事業者）を作成し、オーナーの user_profiles.client_id を紐づける。
 * 招待受諾フローから呼ぶため admin クライアント（RLSバイパス）を使用する。
 * clients の INSERT は RLS 上 white_label_owner/system_admin のみ許可のため。
 */
export async function createClientForOwner(
  input: CreateClientInput,
): Promise<{ id: string }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("clients")
    .insert({
      white_label_id: input.whiteLabelId,
      owner_user_id: input.ownerUserId,
      business_name: input.businessName,
      status: "active",
      ...(input.planId ? { plan_id: input.planId } : {}),
    })
    .select("id")
    .single();

  if (error || !data) {
    throwSafe("クライアントの作成に失敗しました", error);
  }

  const clientId = data.id as string;

  const { error: profileError } = await supabase
    .from("user_profiles")
    .update({ client_id: clientId })
    .eq("id", input.ownerUserId);

  if (profileError) {
    // 補償: プロフィール紐づけに失敗したら作成した clients を削除して整合を保つ。
    const { error: cleanupError } = await supabase
      .from("clients")
      .delete()
      .eq("id", clientId);
    if (cleanupError) {
      console.error(
        `[clients] 補償削除に失敗（orphan client の可能性）: clientId=${clientId} ${cleanupError.message}`,
      );
    }
    throw new Error(
      `プロフィールの更新に失敗しました: ${profileError.message}`,
    );
  }

  return { id: clientId };
}

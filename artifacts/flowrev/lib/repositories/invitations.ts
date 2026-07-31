import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

const INVITE_EXPIRY_DAYS = 7;

export interface CreateInvitationInput {
  whiteLabelId: string;
  invitedBy: string;
  email: string;
  clientName: string;
  representativeName: string;
  planId?: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  clientName: string;
  representativeName: string | null;
  status: string;
  expiresAt: string | null;
  createdAt: string | null;
}

/**
 * 暗号学的に安全な招待トークンを生成する（64文字の16進数・§14-1）。
 */
function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * クライアント招待を作成する（RLS 適用のセッションクライアント）。
 * white_label_owner のテナント配下にのみ作成可能（RLS WITH CHECK で担保）。
 * 7日間有効なトークンを発行し、token を返す。
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ id: string; token: string }> {
  const supabase = createClient();
  const token = generateInviteToken();
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      white_label_id: input.whiteLabelId,
      invited_by: input.invitedBy,
      email: input.email,
      client_name: input.clientName,
      representative_name: input.representativeName,
      plan_id: input.planId ?? null,
      token,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id, token")
    .single();

  if (error || !data) {
    throwSafe("招待の作成に失敗しました", error);
  }

  return { id: data.id as string, token: data.token as string };
}

/**
 * テナント配下の招待一覧を取得する（新しい順）。RLS で自テナントのみ。
 * acceptedOnly=false（デフォルト）は全件。pending のみが必要な場合は pendingOnly を使う。
 */
export async function listInvitations(): Promise<InvitationRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, email, client_name, representative_name, status, expires_at, created_at",
    )
    .neq("status", "accepted")
    .order("created_at", { ascending: false });

  if (error) {
    throwSafe("招待一覧の取得に失敗しました", error);
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    clientName: r.client_name as string,
    representativeName: (r.representative_name as string) ?? null,
    status: r.status as string,
    expiresAt: (r.expires_at as string) ?? null,
    createdAt: (r.created_at as string) ?? null,
  }));
}

export interface ValidInvitation {
  id: string;
  whiteLabelId: string;
  email: string;
  clientName: string;
  representativeName: string | null;
  planId: string | null;
}

/**
 * トークンに対応する「有効な」招待を返す（admin クライアントで RLS バイパス）。
 * 未ログインの受諾フローから呼ぶため service-role を使う。
 * 存在しない / status!='pending' / 期限切れ の場合は null を返す。
 */
export async function getValidInvitationByToken(
  token: string,
): Promise<ValidInvitation | null> {
  if (!token) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, white_label_id, email, client_name, representative_name, plan_id, status, expires_at",
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.status !== "pending") return null;
  if (!data.expires_at || new Date(data.expires_at as string) <= new Date()) {
    return null;
  }

  return {
    id: data.id as string,
    whiteLabelId: data.white_label_id as string,
    email: data.email as string,
    clientName: data.client_name as string,
    representativeName: (data.representative_name as string) ?? null,
    planId: (data.plan_id as string) ?? null,
  };
}

/**
 * 招待を「請求」する（pending → accepted への条件付き更新, §14-1 即時無効化）。
 * pending のものだけを対象にし、更新件数を検証することで二重受諾を確実に防ぐ。
 * 1件更新できた場合のみ true（＝このリクエストが招待を獲得した）を返す。
 */
export async function claimInvitation(token: string): Promise<boolean> {
  const supabase = createAdminClient();
  // 検証（pending かつ未期限）と請求を同一の原子的更新で行い、検証〜請求間の
  // 期限到達・競合の窓をなくす。
  const { data, error } = await supabase
    .from("invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("token", token)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    throwSafe("招待ステータスの更新に失敗しました", error);
  }

  return (data?.length ?? 0) > 0;
}

/**
 * 招待を削除する（pending / expired のみ。accepted は削除不可）。
 * RLS でテナント分離済みのセッションクライアントを使う。
 */
export async function deleteInvitation(
  id: string,
  whiteLabelId: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", id)
    .eq("white_label_id", whiteLabelId)
    .neq("status", "accepted");

  if (error) {
    throwSafe("招待の削除に失敗しました", error);
  }
}

/**
 * 招待トークンを更新し、有効期限を延長する（再送用）。
 * accepted 済みの招待は対象外。新しいトークンを返す。
 */
export async function resendInvitationToken(
  id: string,
  whiteLabelId: string,
): Promise<{ token: string }> {
  const supabase = createClient();
  const token = generateInviteToken();
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("invitations")
    .update({ token, expires_at: expiresAt, status: "pending" })
    .eq("id", id)
    .eq("white_label_id", whiteLabelId)
    .neq("status", "accepted")
    .select("id")
    .single();

  if (error || !data) {
    throwSafe("招待トークンの更新に失敗しました", error);
  }

  return { token };
}

/**
 * 招待を pending に戻す（受諾処理が途中失敗した際の補償用, admin クライアント）。
 * 補償失敗は呼び出し側で監査ログ化できるよう error を返す。
 */
export async function revertInvitationToPending(
  token: string,
): Promise<{ error: string | null }> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("invitations")
    .update({ status: "pending", accepted_at: null })
    .eq("token", token);
  return { error: error?.message ?? null };
}

import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface WhiteLabelListItem {
  id: string;
  brandName: string;
  brandColor: string | null;
  status: string | null;
  planName: string | null;
  ownerEmail: string | null;
  createdAt: string | null;
}

export interface CreateWhiteLabelInput {
  brandName: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerDisplayName?: string;
  planId?: string;
  brandColor?: string;
}

/**
 * ホワイトラベル一覧を取得する（管理者クライアント・RLSバイパス）。
 * 呼び出し側で system_admin であることを必ず確認すること。
 */
export async function listWhiteLabels(): Promise<WhiteLabelListItem[]> {
  const admin = createAdminClient();

  // plans は外部キー名を明示して埋め込む。0012_plans_white_label_id.sql で
  // plans.white_label_id → white_labels.id が追加された結果、white_labels と plans の間に
  // 関係が2本存在するようになり、`plans(name)` のままでは PostgREST が
  // どちらを辿るか決められずエラー（PGRST201）になるため。
  const { data, error } = await admin
    .from("white_labels")
    .select(
      "id, brand_name, brand_color, status, created_at, owner_user_id, plans!white_labels_plan_id_fkey(name)",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throwSafe("ホワイトラベルの取得に失敗しました", error);
  }

  // オーナーのメールを auth.users から一括取得してマッピングする。
  const { data: usersData } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const emailById = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  return (data ?? []).map((row) => {
    const plan = row.plans as { name: string } | { name: string }[] | null;
    const planName = Array.isArray(plan) ? (plan[0]?.name ?? null) : (plan?.name ?? null);
    return {
      id: row.id as string,
      brandName: row.brand_name as string,
      brandColor: (row.brand_color as string) ?? null,
      status: (row.status as string) ?? null,
      planName,
      ownerEmail: emailById.get(row.owner_user_id as string) ?? null,
      createdAt: (row.created_at as string) ?? null,
    };
  });
}

export interface WhiteLabelDetail {
  id: string;
  brandName: string;
  brandColor: string | null;
  status: string;
  planId: string | null;
  ownerUserId: string | null;
}

export interface UpdateWhiteLabelInput {
  brandName?: string;
  brandColor?: string;
  planId?: string | null;
  status?: string;
}

/**
 * ホワイトラベルを1件取得する（管理者クライアント）。
 */
export async function getWhiteLabel(id: string): Promise<WhiteLabelDetail | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("white_labels")
    .select("id, brand_name, brand_color, status, plan_id, owner_user_id")
    .eq("id", id)
    .maybeSingle();

  if (error) throwSafe("取得に失敗しました", error);
  if (!data) return null;

  return {
    id: data.id as string,
    brandName: data.brand_name as string,
    brandColor: (data.brand_color as string) ?? null,
    status: (data.status as string) ?? "active",
    planId: (data.plan_id as string) ?? null,
    ownerUserId: (data.owner_user_id as string) ?? null,
  };
}

/**
 * ホワイトラベルを更新する（管理者クライアント）。
 */
export async function updateWhiteLabel(
  id: string,
  input: UpdateWhiteLabelInput,
): Promise<void> {
  const admin = createAdminClient();
  const payload: Record<string, unknown> = {};
  if (input.brandName !== undefined) payload.brand_name = input.brandName;
  if (input.brandColor !== undefined) payload.brand_color = input.brandColor;
  if (input.planId !== undefined) payload.plan_id = input.planId ?? null;
  if (input.status !== undefined) payload.status = input.status;

  const { error } = await admin
    .from("white_labels")
    .update(payload)
    .eq("id", id);

  if (error) throwSafe("更新に失敗しました", error);
}

/**
 * ホワイトラベルのステータスを切り替える（active ↔ suspended）。
 */
export async function toggleWhiteLabelStatus(
  id: string,
  status: "active" | "suspended",
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("white_labels")
    .update({ status })
    .eq("id", id);

  if (error) throwSafe("ステータス変更に失敗しました", error);
}

/**
 * ホワイトラベルとオーナーユーザーを削除する（管理者クライアント）。
 */
export async function deleteWhiteLabel(id: string): Promise<void> {
  const admin = createAdminClient();

  const { data: wl } = await admin
    .from("white_labels")
    .select("owner_user_id")
    .eq("id", id)
    .maybeSingle();

  const { error: wlError } = await admin
    .from("white_labels")
    .delete()
    .eq("id", id);

  if (wlError) throw new Error(`削除に失敗しました: ${wlError.message}`);

  if (wl?.owner_user_id) {
    await admin.auth.admin.deleteUser(wl.owner_user_id as string);
  }
}

/**
 * ロールバック（補償処理）の失敗を集約し、手動確認が必要な旨を付記する。
 * 補償が全て成功なら空文字を返す。
 */
function rollbackNote(
  cleanupErrors: (string | undefined | null)[],
  userId: string,
): string {
  const errs = cleanupErrors.filter((e): e is string => Boolean(e));
  if (errs.length === 0) return "";
  return ` ※ロールバックが不完全です。手動確認が必要（userId=${userId}）: ${errs.join(" / ")}`;
}

/**
 * ホワイトラベルとそのオーナーユーザーを作成する（管理者クライアント）。
 * 1) オーナー認証ユーザー作成（トリガーが user_profiles を生成）
 * 2) white_labels 作成
 * 3) user_profiles.white_label_id を紐付け（更新1件を厳密確認）
 * 途中で失敗した場合は作成済みリソースをロールバックし、
 * 補償処理自体が失敗した場合はその旨をエラーに含める。
 */
export async function createWhiteLabel(
  input: CreateWhiteLabelInput,
): Promise<{ id: string }> {
  const admin = createAdminClient();

  // 1) オーナー認証ユーザー
  const { data: created, error: createUserError } =
    await admin.auth.admin.createUser({
      email: input.ownerEmail,
      password: input.ownerPassword,
      email_confirm: true,
      user_metadata: {
        role: "white_label_owner",
        display_name: input.ownerDisplayName ?? input.ownerEmail,
      },
    });

  if (createUserError || !created?.user) {
    throw new Error(
      `オーナーユーザーの作成に失敗しました: ${createUserError?.message ?? "不明なエラー"}`,
    );
  }
  const userId = created.user.id;

  // 2) white_labels
  const insertPayload: Record<string, unknown> = {
    owner_user_id: userId,
    brand_name: input.brandName,
  };
  if (input.planId) insertPayload.plan_id = input.planId;
  if (input.brandColor) insertPayload.brand_color = input.brandColor;

  const { data: wl, error: wlError } = await admin
    .from("white_labels")
    .insert(insertPayload)
    .select("id")
    .single();

  if (wlError || !wl) {
    const { error: userCleanupError } =
      await admin.auth.admin.deleteUser(userId);
    throw new Error(
      `ホワイトラベルの作成に失敗しました: ${wlError?.message ?? "不明なエラー"}` +
        rollbackNote([userCleanupError?.message], userId),
    );
  }
  const wlId = wl.id as string;

  // 3) プロフィールにテナントを紐付け（更新が1件であることを厳密に確認）
  const { data: updatedRows, error: profileError } = await admin
    .from("user_profiles")
    .update({ white_label_id: wlId })
    .eq("id", userId)
    .select("id");

  if (profileError || !updatedRows || updatedRows.length !== 1) {
    const { error: wlCleanupError } = await admin
      .from("white_labels")
      .delete()
      .eq("id", wlId);
    const { error: userCleanupError } =
      await admin.auth.admin.deleteUser(userId);
    const reason =
      profileError?.message ??
      "対象プロフィールが見つかりませんでした（更新0件）";
    throw new Error(
      `オーナーのテナント紐付けに失敗しました: ${reason}` +
        rollbackNote([wlCleanupError?.message, userCleanupError?.message], userId),
    );
  }

  return { id: wlId };
}

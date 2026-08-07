import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAuthEmail } from "@/lib/email/send-auth-email";

export interface InviteCustomerInput {
  email: string;
  clientId: string;
  whiteLabelId: string | null;
  displayName?: string | null;
  /** リンクの絶対URLを組み立てる起点。例: `https://app.example.com` */
  origin: string;
  /** 認証後の着地先。会員ページなら `/my` */
  next: string;
}

export interface InviteCustomerResult {
  authUserId: string | null;
  error: string | null;
}

/**
 * 購入者・LP登録者をcustomerとして招待し、テナント情報を紐付ける。
 *
 * `auth.users` へのINSERTは `on_auth_user_created` トリガーを起動し、
 * トリガーは `raw_user_meta_data` の `client_id` / `white_label_id` を読んで
 * `user_profiles` を作る。したがって**招待時のメタデータにテナント情報を含める必要がある**。
 *
 * 以前はメタデータに `role` しか渡しておらず、トリガーが `client_id` を NULL のまま
 * 行を作成 → 後続の upsert が `ignoreDuplicates: true` で何もしない、という経路で
 * 購入者の `user_profiles.client_id` が NULL のままになっていた。
 * `/my` は `session.clientId` を必須とするため、購入者が会員エリアに入れなくなる。
 */
export async function inviteCustomerWithTenant(
  input: InviteCustomerInput,
): Promise<InviteCustomerResult> {
  const admin = createAdminClient();

  // Supabase のメーラーではなく自前で送る（OEMごとの文面を使うため）。
  // inviteUserByEmail と同じくユーザーを作成し、メタデータをトリガーへ渡す。
  const { authUserId, error } = await sendAuthEmail({
    key: "invite",
    email: input.email,
    whiteLabelId: input.whiteLabelId,
    origin: input.origin,
    next: input.next,
    displayName: input.displayName ?? null,
    userData: {
      role: "customer",
      client_id: input.clientId,
      white_label_id: input.whiteLabelId,
      display_name: input.displayName ?? null,
    },
  });

  if (!authUserId) {
    return { authUserId: null, error: error ?? "招待に失敗しました。" };
  }

  // トリガーが無い環境や、トリガーより先にこの経路が走った場合に備えて行を作る。
  // 既に行があれば触らない（他テナントに所属する既存ユーザーを奪わないため）。
  await admin.from("user_profiles").upsert(
    {
      id: authUserId,
      role: "customer",
      display_name: input.displayName ?? null,
      client_id: input.clientId,
      white_label_id: input.whiteLabelId,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  // テナント未設定の行だけを補正する。
  // `.is("client_id", null)` を付けることで、既にどこかのテナントに属している
  // ユーザーの所属を書き換えてしまう事故を防ぐ。
  await admin
    .from("user_profiles")
    .update({
      client_id: input.clientId,
      white_label_id: input.whiteLabelId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", authUserId)
    .is("client_id", null);

  // customers 行を認証ユーザーに紐付ける
  await admin
    .from("customers")
    .update({ user_id: authUserId, updated_at: new Date().toISOString() })
    .eq("email", input.email)
    .eq("client_id", input.clientId);

  // 送信に失敗していても、ここまでのテナント紐付けは完了させたうえで
  // 理由を返す。呼び出し側が握りつぶすと「決済は成立したのに招待メールだけ
  // 届かず、ログにも何も残らない」状態になるため、error は捨てない。
  return { authUserId, error };
}

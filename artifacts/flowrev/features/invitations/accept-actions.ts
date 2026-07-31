"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getValidInvitationByToken,
  claimInvitation,
  revertInvitationToPending,
} from "@/lib/repositories/invitations";
import { createClientForOwner } from "@/lib/repositories/clients";

const schema = z
  .object({
    token: z.string().trim().min(1),
    password: z
      .string()
      .min(8, "パスワードは8文字以上で入力してください。"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "パスワードが一致しません。",
    path: ["confirmPassword"],
  });

export interface AcceptInvitationState {
  error: string | null;
}

/**
 * Supabase Admin REST API でメールアドレスから auth.users の id を取得する。
 * JS SDK に getUserByEmail がないため fetch で直接呼ぶ。
 */
async function findUserIdByEmail(email: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
        },
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { users?: Array<{ id: string }> };
    return json.users?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 招待受諾サーバーアクション。
 * トークン検証 → Auth ユーザー作成（既存なら更新）→ clients 作成 →
 * 招待を accepted に更新 → サインインして client_owner ダッシュボードへリダイレクト。
 *
 * 【再登録対応】同メールで一度削除後に再招待した場合、Auth ユーザーが残っているため
 * createUser が "already exists" で失敗する。その場合は既存ユーザーのパスワードと
 * メタデータを更新し、user_profiles をリセットして再利用する。
 */
export async function acceptInvitationAction(
  _prevState: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }

  const { token, password } = parsed.data;

  const invitation = await getValidInvitationByToken(token);
  if (!invitation) {
    return {
      error: "招待が無効か、有効期限が切れています。招待者にご確認ください。",
    };
  }

  const admin = createAdminClient();
  const displayName = invitation.representativeName ?? invitation.clientName;
  const userMeta = {
    role: "client_owner",
    white_label_id: invitation.whiteLabelId,
    display_name: displayName,
    client_name: invitation.clientName,
  };

  // --- Auth ユーザーの確保（新規作成 or 既存更新）---
  let userId: string;
  let isNewUser = false;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: userMeta,
  });

  if (createError) {
    const isAlreadyExists = createError.message?.toLowerCase().includes("already");
    if (!isAlreadyExists) {
      return {
        error: `アカウント作成に失敗しました: ${createError.message ?? "不明なエラー"}`,
      };
    }

    // 既存 Auth ユーザーを再利用する
    const existingId = await findUserIdByEmail(invitation.email);
    if (!existingId) {
      return {
        error: "既存アカウントの取得に失敗しました。管理者にご連絡ください。",
      };
    }

    // 招待URL（トークン）は招待作成者（white_label_owner）自身にも直接返却されるため、
    // このメールアドレスが既に他テナント／他ロールの有効なアカウントである場合に
    // 無条件でパスワード・ロール・所属を上書きすると、招待作成者がメールアドレスを
    // 知っているだけで任意アカウントを乗っ取れてしまう（アカウント乗っ取り対策）。
    // 「このメールが自分の white_label 配下の client_owner だった」場合のみ再利用を許可する。
    const { data: existingProfile } = await admin
      .from("user_profiles")
      .select("white_label_id, role")
      .eq("id", existingId)
      .maybeSingle();

    const isSameTenantClientOwner =
      existingProfile?.role === "client_owner" &&
      existingProfile?.white_label_id === invitation.whiteLabelId;

    if (!isSameTenantClientOwner) {
      return {
        error:
          "このメールアドレスは既に別のアカウントで使用されています。管理者にご連絡ください。",
      };
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
      user_metadata: userMeta,
    });
    if (updateError) {
      return {
        error: `アカウントの更新に失敗しました: ${updateError.message}`,
      };
    }

    // user_profiles を再登録向けにリセット（client_id は createClientForOwner が上書き）
    await admin
      .from("user_profiles")
      .upsert(
        {
          id: existingId,
          role: "client_owner",
          white_label_id: invitation.whiteLabelId,
          display_name: displayName,
          client_id: null,
        },
        { onConflict: "id" },
      );

    userId = existingId;
    isNewUser = false;
  } else {
    if (!created?.user) {
      return { error: "アカウント作成に失敗しました。" };
    }
    userId = created.user.id;
    isNewUser = true;
  }

  // 新規ユーザーのみ削除補償を行う（既存ユーザーは削除しない）
  const cleanupUser = async () => {
    if (!isNewUser) return;
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error(
        `[invite-accept] ユーザー補償削除に失敗（残留の可能性）: userId=${userId} token=${token} ${error.message}`,
      );
    }
  };

  // 招待を排他的に請求する
  let claimed = false;
  try {
    claimed = await claimInvitation(token);
  } catch (e) {
    await cleanupUser();
    return {
      error: e instanceof Error ? e.message : "登録処理に失敗しました。",
    };
  }

  if (!claimed) {
    await cleanupUser();
    return {
      error: "この招待は既に使用されています。招待者にご確認ください。",
    };
  }

  try {
    await createClientForOwner({
      whiteLabelId: invitation.whiteLabelId,
      ownerUserId: userId,
      businessName: invitation.clientName,
      planId: invitation.planId ?? null,
    });
  } catch (e) {
    await cleanupUser();
    const { error: revertError } = await revertInvitationToPending(token);
    if (revertError) {
      console.error(
        `[invite-accept] 招待の pending 復帰に失敗: token=${token} ${revertError}`,
      );
    }
    return {
      error: e instanceof Error ? e.message : "登録処理に失敗しました。",
    };
  }

  const supabase = createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password,
  });

  if (signInError) {
    redirect("/login");
  }

  redirect("/dashboard");
}

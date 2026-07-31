"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/features/auth/session";
import {
  createInvitation,
  deleteInvitation,
  resendInvitationToken,
} from "@/lib/repositories/invitations";
import { sendInvitationEmail } from "@/lib/email/send-invite";

const schema = z.object({
  clientName: z.string().trim().min(1, "クライアント名を入力してください。"),
  representativeName: z
    .string()
    .trim()
    .min(1, "代表者名を入力してください。"),
  email: z.string().trim().email("有効なメールアドレスを入力してください。"),
  planId: z.string().uuid().optional(),
});

export interface CreateInvitationState {
  error: string | null;
  inviteUrl: string | null;
  emailSent: boolean;
  emailError: string | null;
}

function buildInviteUrl(token: string): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (explicit) return `${explicit}/register?token=${token}`;

  throw new Error(
    "アプリのURLを自動取得できませんでした。NEXT_PUBLIC_APP_URL 環境変数を設定してください。",
  );
}

/**
 * クライアント招待作成サーバーアクション。
 * white_label_owner のみ実行可能。招待を作成し、共有用の招待URLを返す。
 * （メール送信は Resend 接続後に差し込む。）
 */
export async function createInvitationAction(
  _prevState: CreateInvitationState,
  formData: FormData,
): Promise<CreateInvitationState> {
  const session = await getSessionProfile();
  if (session?.role !== "white_label_owner" || !session.whiteLabelId) {
    return {
      error: "この操作を行う権限がありません。",
      inviteUrl: null,
      emailSent: false,
      emailError: null,
    };
  }

  const planIdRaw = String(formData.get("planId") ?? "").trim();
  const parsed = schema.safeParse({
    clientName: formData.get("clientName"),
    representativeName: formData.get("representativeName"),
    email: formData.get("email"),
    planId: planIdRaw || undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
      inviteUrl: null,
      emailSent: false,
      emailError: null,
    };
  }

  let inviteUrl: string;
  let token: string;
  try {
    const result = await createInvitation({
      whiteLabelId: session.whiteLabelId,
      invitedBy: session.userId,
      email: parsed.data.email,
      clientName: parsed.data.clientName,
      representativeName: parsed.data.representativeName,
      planId: parsed.data.planId,
    });
    token = result.token;
    inviteUrl = buildInviteUrl(token);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "招待の作成に失敗しました。",
      inviteUrl: null,
      emailSent: false,
      emailError: null,
    };
  }

  // 招待は作成済み。メール送信に失敗してもURL共有で継続できるよう、
  // 送信失敗は致命的エラーにせず警告として返す。
  let emailSent = false;
  let emailError: string | null = null;
  try {
    await sendInvitationEmail({
      whiteLabelId: session.whiteLabelId,
      toEmail: parsed.data.email,
      clientName: parsed.data.clientName,
      inviteUrl,
    });
    emailSent = true;
  } catch (e) {
    emailError =
      e instanceof Error ? e.message : "招待メールの送信に失敗しました。";
    console.error("[invitation] email send failed:", emailError);
  }

  revalidatePath("/wl/clients");
  return { error: null, inviteUrl, emailSent, emailError };
}

export interface InvitationMutationState {
  error: string | null;
  inviteUrl?: string | null;
  emailSent?: boolean;
  emailError?: string | null;
}

/**
 * 招待を削除する（pending / expired のみ）。
 */
export async function deleteInvitationAction(
  _prevState: InvitationMutationState,
  formData: FormData,
): Promise<InvitationMutationState> {
  const session = await getSessionProfile();
  if (session?.role !== "white_label_owner" || !session.whiteLabelId) {
    return { error: "この操作を行う権限がありません。" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "IDが不正です。" };

  try {
    await deleteInvitation(id, session.whiteLabelId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "削除に失敗しました。" };
  }

  revalidatePath("/wl/clients");
  return { error: null };
}

/**
 * 招待を再送する（新トークン発行 + メール送信）。
 */
export async function resendInvitationAction(
  _prevState: InvitationMutationState,
  formData: FormData,
): Promise<InvitationMutationState> {
  const session = await getSessionProfile();
  if (session?.role !== "white_label_owner" || !session.whiteLabelId) {
    return { error: "この操作を行う権限がありません。" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const clientName = String(formData.get("clientName") ?? "").trim();
  if (!id) return { error: "IDが不正です。" };

  let inviteUrl: string;
  try {
    const { token } = await resendInvitationToken(id, session.whiteLabelId);
    inviteUrl = buildInviteUrl(token);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "再送に失敗しました。" };
  }

  let emailSent = false;
  let emailError: string | null = null;
  try {
    await sendInvitationEmail({
      whiteLabelId: session.whiteLabelId,
      toEmail: email,
      clientName,
      inviteUrl,
    });
    emailSent = true;
  } catch (e) {
    emailError = e instanceof Error ? e.message : "メール送信に失敗しました。";
  }

  revalidatePath("/wl/clients");
  return { error: null, inviteUrl, emailSent, emailError };
}

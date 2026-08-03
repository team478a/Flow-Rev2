import "server-only";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEmailSetting } from "@/lib/repositories/email-settings";
import { resolveAuthEmailTemplate } from "@/lib/repositories/auth-email-templates";
import { getWhiteLabelBranding } from "@/lib/repositories/white-labels";
import {
  buildAuthTextBody,
  renderAuthSubject,
  renderAuthTemplate,
  type AuthTemplateKey,
} from "@/lib/email/auth-templates";

export interface SendAuthEmailInput {
  key: AuthTemplateKey;
  email: string;
  whiteLabelId: string | null;
  /** 認証後の着地先（`/auth/confirm` からの相対パス）。例: `/my` */
  next: string;
  /** リンクの絶対URLを組み立てるための起点。例: `https://app.example.com` */
  origin: string;
  displayName?: string | null;
  /** invite のときトリガーが読む user_metadata。テナント情報を必ず含めること。 */
  userData?: Record<string, unknown>;
}

export interface SendAuthEmailResult {
  /** invite のとき作成/取得された認証ユーザー。recovery では null。 */
  authUserId: string | null;
  error: string | null;
}

/** generateLink の type は「メールの種類」と1対1で対応する。 */
const LINK_TYPE: Record<AuthTemplateKey, "invite" | "recovery"> = {
  invite: "invite",
  recovery: "recovery",
};

/**
 * 認証メールを自前で送る（Supabaseのメーラーを使わない）。
 *
 * なぜ自前送信か:
 *   Supabase のメールテンプレートは**プロジェクト単位**で、OEMごとに
 *   文面やブランドを変えられない。ホワイトラベルとして成立しないため、
 *   リンクの生成だけ Supabase に任せ、本文の組み立てと送信は自前で行う。
 *
 * generateLink はメールを送らずリンク素材だけを返す。ここから
 * `hashed_token` を取り出し、`/auth/confirm` へ向けたURLを自分で組む。
 * 管理（service_role）クライアント経由なのでPKCEを通らず、
 * token_hash は verifyOtp で検証できる通常のトークンになる。
 */
export async function sendAuthEmail(
  input: SendAuthEmailInput,
): Promise<SendAuthEmailResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: LINK_TYPE[input.key],
    email: input.email,
    options: {
      redirectTo: `${input.origin}/auth/confirm`,
      ...(input.userData ? { data: input.userData } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  const hashedToken = data?.properties?.hashed_token;
  if (!hashedToken) {
    return {
      authUserId: null,
      error: error?.message ?? "認証リンクの生成に失敗しました。",
    };
  }

  const authUserId = data?.user?.id ?? null;

  const params = new URLSearchParams({
    token_hash: hashedToken,
    type: LINK_TYPE[input.key],
    next: input.next,
  });
  const link = `${input.origin}/auth/confirm?${params.toString()}`;

  const branding = input.whiteLabelId
    ? await getWhiteLabelBranding(input.whiteLabelId).catch(() => null)
    : null;

  const vars = {
    link,
    brand: branding?.brandName || "FlowRev",
    name: input.displayName ?? "",
  };

  const template = await resolveAuthEmailTemplate(input.whiteLabelId, input.key);
  const setting = await getActiveEmailSetting(input.whiteLabelId);

  if (!setting?.fromEmail) {
    // 送信設定が無いと認証メールが一通も届かない。呼び出し側が握りつぶす場合に
    // 備え、原因が分かる文言を返す（宛先アドレスは含めない）。
    return {
      authUserId,
      error:
        "メール設定（Resend）が未登録のため送信できません。管理画面で送信元を登録してください。",
    };
  }

  const from = setting.fromName
    ? `${setting.fromName} <${setting.fromEmail}>`
    : setting.fromEmail;

  const resend = new Resend(setting.apiKey);
  const { error: sendError } = await resend.emails.send({
    from,
    to: input.email,
    subject: renderAuthSubject(template.subject, vars),
    html: renderAuthTemplate(template.bodyHtml, vars),
    text: buildAuthTextBody(vars),
  });

  if (sendError) {
    return { authUserId, error: `メール送信に失敗しました: ${sendError.message}` };
  }

  return { authUserId, error: null };
}

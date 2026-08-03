import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";
import {
  DEFAULT_AUTH_TEMPLATES,
  type AuthEmailTemplate,
  type AuthTemplateKey,
} from "@/lib/email/auth-templates";

export interface AuthTemplateRow extends AuthEmailTemplate {
  /** どの階層の設定が使われているか。画面の「継承元」表示に使う。 */
  tier: "white_label" | "hq" | "default";
}

const COLUMNS = "template_key, subject, body_html";

/**
 * 送信に使うテンプレートを解決する（OEM → HQ → コード内の既定）。
 *
 * 他のAPI設定と同じ順序。既定へ落とせるので、テーブルが空でも
 * 認証メールが届かなくなることはない。
 */
export async function resolveAuthEmailTemplate(
  whiteLabelId: string | null,
  key: AuthTemplateKey,
): Promise<AuthTemplateRow> {
  const admin = createAdminClient();

  if (whiteLabelId) {
    const { data } = await admin
      .from("auth_email_templates")
      .select(COLUMNS)
      .eq("white_label_id", whiteLabelId)
      .eq("template_key", key)
      .maybeSingle();

    const row = data as Record<string, unknown> | null;
    if (row?.body_html) {
      return {
        subject: row.subject as string,
        bodyHtml: row.body_html as string,
        tier: "white_label",
      };
    }
  }

  const { data: hq } = await admin
    .from("auth_email_templates")
    .select(COLUMNS)
    .is("white_label_id", null)
    .eq("template_key", key)
    .maybeSingle();

  const hqRow = hq as Record<string, unknown> | null;
  if (hqRow?.body_html) {
    return {
      subject: hqRow.subject as string,
      bodyHtml: hqRow.body_html as string,
      tier: "hq",
    };
  }

  return { ...DEFAULT_AUTH_TEMPLATES[key], tier: "default" };
}

/**
 * 編集画面に表示する内容を取得する。
 * 自分の階層に保存が無ければ、継承している内容をそのまま初期値として返す
 * （空欄から書き始めさせると、うっかり保存でリンクの無いメールになりうる）。
 */
export async function getAuthEmailTemplateForEdit(
  whiteLabelId: string | null,
  key: AuthTemplateKey,
): Promise<AuthTemplateRow> {
  const admin = createAdminClient();

  const query = admin
    .from("auth_email_templates")
    .select(COLUMNS)
    .eq("template_key", key);

  const { data } = whiteLabelId
    ? await query.eq("white_label_id", whiteLabelId).maybeSingle()
    : await query.is("white_label_id", null).maybeSingle();

  const row = data as Record<string, unknown> | null;
  if (row?.body_html) {
    return {
      subject: row.subject as string,
      bodyHtml: row.body_html as string,
      tier: whiteLabelId ? "white_label" : "hq",
    };
  }

  // 自分の行が無い場合は、実際に送信で使われる内容（＝継承元）を見せる。
  return resolveAuthEmailTemplate(whiteLabelId, key);
}

export interface SaveAuthEmailTemplateInput {
  key: AuthTemplateKey;
  subject: string;
  bodyHtml: string;
}

/**
 * テンプレートを保存する。`whiteLabelId` が null なら本部（HQ）の既定を更新する。
 *
 * 対象行を `white_label_id` で厳密に絞る。ここを緩めると、OEMオーナーの保存が
 * 本部の既定や他OEMの文面を書き換え、全テナントの認証メールに波及する。
 */
export async function saveAuthEmailTemplate(
  whiteLabelId: string | null,
  input: SaveAuthEmailTemplateInput,
): Promise<void> {
  const admin = createAdminClient();

  const base = admin
    .from("auth_email_templates")
    .select("id")
    .eq("template_key", input.key);

  const { data: existing, error: selectError } = whiteLabelId
    ? await base.eq("white_label_id", whiteLabelId).maybeSingle()
    : await base.is("white_label_id", null).maybeSingle();

  if (selectError) throwSafe("テンプレートの取得に失敗しました", selectError);

  const payload = {
    subject: input.subject,
    body_html: input.bodyHtml,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await admin
      .from("auth_email_templates")
      .update(payload)
      .eq("id", (existing as Record<string, unknown>).id as string);
    if (error) throwSafe("テンプレートの更新に失敗しました", error);
    return;
  }

  const { error } = await admin.from("auth_email_templates").insert({
    ...payload,
    white_label_id: whiteLabelId,
    template_key: input.key,
  });
  if (error) throwSafe("テンプレートの保存に失敗しました", error);
}

/**
 * 自分の階層の保存を削除し、上位階層の継承へ戻す。
 */
export async function resetAuthEmailTemplate(
  whiteLabelId: string | null,
  key: AuthTemplateKey,
): Promise<void> {
  const admin = createAdminClient();

  const base = admin
    .from("auth_email_templates")
    .delete()
    .eq("template_key", key);

  const { error } = whiteLabelId
    ? await base.eq("white_label_id", whiteLabelId)
    : await base.is("white_label_id", null);

  if (error) throwSafe("テンプレートの削除に失敗しました", error);
}

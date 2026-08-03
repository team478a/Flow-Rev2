"use server";

import { revalidatePath } from "next/cache";
import { requireSystemAdmin } from "@/features/admin/guard";
import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { saveAuthEmailTemplate } from "@/lib/repositories/auth-email-templates";
import {
  AUTH_TEMPLATE_KEYS,
  type AuthTemplateKey,
} from "@/lib/email/auth-templates";
import type { SaveAuthTemplateState } from "@/features/admin/components/auth-template-form";

/**
 * フォーム入力を検証する。
 *
 * `{{link}}` の有無を必須にしているのは、リンクの無い認証メールが
 * 「届いてはいるが何もできない」状態を作るため。編集中に消してしまっても
 * 保存も送信も成功してしまい、受け取った利用者が詰まるまで誰も気づかない。
 */
function parse(formData: FormData):
  | { ok: true; key: AuthTemplateKey; subject: string; bodyHtml: string }
  | { ok: false; error: string } {
  const key = String(formData.get("templateKey") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const bodyHtml = String(formData.get("bodyHtml") ?? "").trim();

  if (!AUTH_TEMPLATE_KEYS.includes(key as AuthTemplateKey)) {
    return { ok: false, error: "テンプレートの種別が不正です。" };
  }
  if (!subject) return { ok: false, error: "件名を入力してください。" };
  if (!bodyHtml) return { ok: false, error: "本文を入力してください。" };
  if (!/\{\{\s*link\s*\}\}/.test(bodyHtml)) {
    return {
      ok: false,
      error:
        "本文に {{link}} を含めてください。認証リンクが無いメールでは、受け取った方が手続きを完了できません。",
    };
  }

  return { ok: true, key: key as AuthTemplateKey, subject, bodyHtml };
}

/**
 * 本部（HQ）の共通テンプレートを保存する。system_admin のみ。
 */
export async function saveHqAuthTemplateAction(
  _prev: SaveAuthTemplateState,
  formData: FormData,
): Promise<SaveAuthTemplateState> {
  await requireSystemAdmin();

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error, success: false };

  try {
    await saveAuthEmailTemplate(null, {
      key: parsed.key,
      subject: parsed.subject,
      bodyHtml: parsed.bodyHtml,
    });
    revalidatePath("/admin/settings/auth-emails");
    return { error: null, success: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "保存に失敗しました。",
      success: false,
    };
  }
}

/**
 * OEM専用のテンプレートを保存する。
 *
 * 対象の `white_label_id` はセッションから取る。フォームから受け取らない
 * （他OEMのIDを送られても書き換えられないようにするため）。
 */
export async function saveWlAuthTemplateAction(
  _prev: SaveAuthTemplateState,
  formData: FormData,
): Promise<SaveAuthTemplateState> {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return { error: "OEM情報が取得できません。", success: false };
  }

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error, success: false };

  try {
    await saveAuthEmailTemplate(session.whiteLabelId, {
      key: parsed.key,
      subject: parsed.subject,
      bodyHtml: parsed.bodyHtml,
    });
    revalidatePath("/wl/settings/auth-emails");
    return { error: null, success: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "保存に失敗しました。",
      success: false,
    };
  }
}

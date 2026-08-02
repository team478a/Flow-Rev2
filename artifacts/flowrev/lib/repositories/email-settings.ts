import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

const PROVIDER = "resend";

export interface EmailSettingResolved {
  apiKey: string;
  fromEmail: string | null;
  fromName: string | null;
  whiteLabelId: string | null;
}

export interface EmailSettingMasked {
  hasApiKey: boolean;
  fromEmail: string | null;
  fromName: string | null;
  isActive: boolean;
}

export interface UpsertHqEmailSettingInput {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

/**
 * HQ共通（white_label_id IS NULL）のメール設定を作成または更新する。
 * APIキーは保存前に暗号化する。設定の保存は system_admin のみ（呼び出し側で検証）。
 */
export async function upsertHqEmailSetting(
  input: UpsertHqEmailSettingInput,
): Promise<void> {
  const supabase = createAdminClient();
  const apiKeyEnc = encrypt(input.apiKey);

  const { data: existing, error: selectError } = await supabase
    .from("email_settings")
    .select("id")
    .is("white_label_id", null)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (selectError) {
    throw new Error(`メール設定の取得に失敗しました: ${selectError.message}`);
  }

  const payload = {
    provider: PROVIDER,
    api_key_enc: apiKeyEnc,
    from_email: input.fromEmail,
    from_name: input.fromName ?? null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase
      .from("email_settings")
      .update(payload)
      .eq("id", existing.id);
    if (error) {
      throwSafe("メール設定の更新に失敗しました", error);
    }
    return;
  }

  const { error } = await supabase
    .from("email_settings")
    .insert({ ...payload, white_label_id: null });
  if (error) {
    throwSafe("メール設定の作成に失敗しました", error);
  }
}

/**
 * HQ共通メール設定をマスク済み（キー非公開）で取得する。設定画面の表示用。
 */
export async function getHqEmailSettingMasked(): Promise<EmailSettingMasked | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_settings")
    .select("api_key_enc, from_email, from_name, is_active")
    .is("white_label_id", null)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (error) {
    throwSafe("メール設定の取得に失敗しました", error);
  }
  if (!data) return null;

  return {
    hasApiKey: Boolean(data.api_key_enc),
    fromEmail: (data.from_email as string) ?? null,
    fromName: (data.from_name as string) ?? null,
    isActive: Boolean(data.is_active),
  };
}

/**
 * 送信に使うメール設定を解決する（WL個別 → HQ共通 のフォールバック）。
 * 有効な設定が無ければ null。APIキーは復号して返す（サーバー内でのみ使用すること）。
 */
export async function getActiveEmailSetting(
  whiteLabelId?: string | null,
): Promise<EmailSettingResolved | null> {
  const supabase = createAdminClient();

  if (whiteLabelId) {
    const { data, error } = await supabase
      .from("email_settings")
      .select("api_key_enc, from_email, from_name")
      .eq("white_label_id", whiteLabelId)
      .eq("provider", PROVIDER)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      throwSafe("メール設定の取得に失敗しました", error);
    }
    if (data?.api_key_enc) {
      return {
        apiKey: decrypt(data.api_key_enc as string),
        fromEmail: (data.from_email as string) ?? null,
        fromName: (data.from_name as string) ?? null,
        whiteLabelId,
      };
    }
  }

  const { data, error } = await supabase
    .from("email_settings")
    .select("api_key_enc, from_email, from_name")
    .is("white_label_id", null)
    .eq("provider", PROVIDER)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    throwSafe("メール設定の取得に失敗しました", error);
  }
  if (!data?.api_key_enc) return null;

  return {
    apiKey: decrypt(data.api_key_enc as string),
    fromEmail: (data.from_email as string) ?? null,
    fromName: (data.from_name as string) ?? null,
    whiteLabelId: null,
  };
}

/**
 * OEM（WL）単位のメール設定を作成または更新する。
 * `uq_email_settings_wl` により (white_label_id, provider) ごとに1件。
 */
export async function upsertWlEmailSetting(
  whiteLabelId: string,
  input: UpsertHqEmailSettingInput,
): Promise<void> {
  const supabase = createAdminClient();
  const apiKeyEnc = encrypt(input.apiKey);

  const { data: existing, error: selectError } = await supabase
    .from("email_settings")
    .select("id")
    .eq("white_label_id", whiteLabelId)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (selectError) throwSafe("メール設定の取得に失敗しました", selectError);

  const payload = {
    provider: PROVIDER,
    api_key_enc: apiKeyEnc,
    from_email: input.fromEmail,
    from_name: input.fromName ?? null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase
      .from("email_settings")
      .update(payload)
      .eq("id", (existing as Record<string, unknown>).id as string);
    if (error) throwSafe("メール設定の更新に失敗しました", error);
    return;
  }

  const { error } = await supabase
    .from("email_settings")
    .insert({ ...payload, white_label_id: whiteLabelId });
  if (error) throwSafe("メール設定の作成に失敗しました", error);
}

/**
 * OEM（WL）単位のメール設定をマスクして返す。
 * フォールバックは行わない（WLオーナーが編集するのは自分のOEM行のため）。
 */
export async function getWlEmailSettingMasked(
  whiteLabelId: string,
): Promise<EmailSettingMasked | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_settings")
    .select("api_key_enc, from_email, from_name, is_active")
    .eq("white_label_id", whiteLabelId)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (error) throwSafe("メール設定の取得に失敗しました", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    hasApiKey: !!(row.api_key_enc as string),
    fromEmail: (row.from_email as string) ?? null,
    fromName: (row.from_name as string) ?? null,
    isActive: row.is_active as boolean,
  };
}

/**
 * OEM単位のメール設定のうち、送信元情報だけを更新する（APIキーは変更しない）。
 * 設定画面でキー欄を空のまま保存した場合に使う。
 */
export async function updateWlEmailSettingProfile(
  whiteLabelId: string,
  fromEmail: string,
  fromName: string | null,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("email_settings")
    .update({
      from_email: fromEmail,
      from_name: fromName,
      updated_at: new Date().toISOString(),
    })
    .eq("white_label_id", whiteLabelId)
    .eq("provider", PROVIDER);
  if (error) throwSafe("メール設定の更新に失敗しました", error);
}

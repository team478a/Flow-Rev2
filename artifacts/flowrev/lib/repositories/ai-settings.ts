import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

export type AiProvider = "anthropic" | "openai";

export interface AiSettingResolved {
  id: string;
  provider: AiProvider;
  apiKey: string;
  model: string | null;
  isActive: boolean;
  whiteLabelId: string | null;
}

export interface AiSettingMasked {
  hasApiKey: boolean;
  provider: AiProvider;
  model: string | null;
  isActive: boolean;
}

export interface UpsertAiSettingInput {
  provider: AiProvider;
  apiKey: string;
  model?: string;
}

/**
 * HQ共通（white_label_id IS NULL）のアクティブなAI設定を取得する（復号済み）。
 * APIキーの利用は system_admin / server-side のみ想定。
 */
export async function getActiveAiSetting(
  provider: AiProvider = "anthropic",
): Promise<AiSettingResolved | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ai_provider_settings")
    .select("id, provider, api_key_enc, model, is_active, white_label_id")
    .eq("provider", provider)
    .eq("is_active", true)
    .is("white_label_id", null)
    .maybeSingle();

  if (error) throwSafe("AI設定の取得に失敗しました", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    provider: row.provider as AiProvider,
    apiKey: decrypt(row.api_key_enc as string),
    model: (row.model as string) ?? null,
    isActive: row.is_active as boolean,
    whiteLabelId: (row.white_label_id as string) ?? null,
  };
}

/** HQ共通のAI設定をマスクして返す（管理画面表示用）。 */
export async function getHqAiSettingMasked(
  provider: AiProvider = "anthropic",
): Promise<AiSettingMasked | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ai_provider_settings")
    .select("api_key_enc, provider, model, is_active")
    .eq("provider", provider)
    .is("white_label_id", null)
    .maybeSingle();

  if (error) throwSafe("AI設定の取得に失敗しました", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    hasApiKey: !!(row.api_key_enc as string),
    provider: row.provider as AiProvider,
    model: (row.model as string) ?? null,
    isActive: row.is_active as boolean,
  };
}

/** HQ共通のAI設定を作成または更新する（system_admin のみ呼び出し可）。 */
export async function upsertHqAiSetting(
  input: UpsertAiSettingInput,
): Promise<void> {
  const supabase = createAdminClient();
  const apiKeyEnc = encrypt(input.apiKey);

  const { data: existing, error: selectError } = await supabase
    .from("ai_provider_settings")
    .select("id")
    .eq("provider", input.provider)
    .is("white_label_id", null)
    .maybeSingle();

  if (selectError)
    throw new Error(`AI設定の取得に失敗しました: ${selectError.message}`);

  const payload = {
    provider: input.provider,
    api_key_enc: apiKeyEnc,
    model: input.model ?? null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const row = existing as Record<string, unknown>;
    const { error } = await supabase
      .from("ai_provider_settings")
      .update(payload)
      .eq("id", row.id as string);
    if (error)
      throwSafe("AI設定の更新に失敗しました", error);
  } else {
    const { error } = await supabase
      .from("ai_provider_settings")
      .insert({ ...payload, white_label_id: null });
    if (error)
      throwSafe("AI設定の作成に失敗しました", error);
  }
}

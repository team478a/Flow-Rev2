import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface StripeSettingsMasked {
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  isLive: boolean;
}

export interface StripeSettingsResolved {
  secretKey: string;
  webhookSecret: string | null;
  isLive: boolean;
}

export interface UpsertStripeSettingsInput {
  secretKey?: string;
  webhookSecret?: string;
  isLive?: boolean;
}

/** 管理画面表示用：キーをマスクして返す */
export async function getStripeSettingsMasked(
  clientId: string,
): Promise<StripeSettingsMasked | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("stripe_accounts")
    .select("access_token_enc, webhook_secret_enc, is_live")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throwSafe("Stripe設定の取得に失敗", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    hasSecretKey: !!(row.access_token_enc as string),
    hasWebhookSecret: !!(row.webhook_secret_enc as string),
    isLive: !!(row.is_live as boolean),
  };
}

/** API呼び出し用：復号済みキーを返す */
export async function getStripeSettingsResolved(
  clientId: string,
): Promise<StripeSettingsResolved | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("stripe_accounts")
    .select("access_token_enc, webhook_secret_enc, is_live")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throwSafe("Stripe設定の取得に失敗", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  if (!row.access_token_enc) return null;

  return {
    secretKey: decrypt(row.access_token_enc as string),
    webhookSecret: row.webhook_secret_enc
      ? decrypt(row.webhook_secret_enc as string)
      : null,
    isLive: !!(row.is_live as boolean),
  };
}

/** Stripe 設定を upsert する */
export async function upsertStripeSettings(
  clientId: string,
  input: UpsertStripeSettingsInput,
): Promise<void> {
  const admin = createAdminClient();

  // 既存レコードを取得
  const { data: existing } = await admin
    .from("stripe_accounts")
    .select("id, access_token_enc, webhook_secret_enc")
    .eq("client_id", clientId)
    .maybeSingle();

  const existingRow = existing as Record<string, unknown> | null;

  // white_label_id を clients テーブルから取得
  const { data: clientRow } = await admin
    .from("clients")
    .select("white_label_id")
    .eq("id", clientId)
    .maybeSingle();
  const whiteLabelId = (clientRow as Record<string, unknown> | null)?.white_label_id as string | null;

  const payload: Record<string, unknown> = {
    is_live: input.isLive ?? false,
    updated_at: new Date().toISOString(),
  };

  // シークレットキー: 入力があれば暗号化、なければ既存値を保持
  if (input.secretKey) {
    payload.access_token_enc = encrypt(input.secretKey);
  } else if (existingRow?.access_token_enc) {
    payload.access_token_enc = existingRow.access_token_enc;
  }

  // Webhook シークレット: 入力があれば暗号化、なければ既存値を保持
  if (input.webhookSecret) {
    payload.webhook_secret_enc = encrypt(input.webhookSecret);
  } else if (existingRow?.webhook_secret_enc) {
    payload.webhook_secret_enc = existingRow.webhook_secret_enc;
  }

  if (existingRow) {
    const { error } = await admin
      .from("stripe_accounts")
      .update(payload)
      .eq("client_id", clientId);
    if (error) throwSafe("Stripe設定の更新に失敗", error);
  } else {
    const { error } = await admin.from("stripe_accounts").insert({
      ...payload,
      client_id: clientId,
      white_label_id: whiteLabelId,
    });
    if (error) throwSafe("Stripe設定の作成に失敗", error);
  }
}

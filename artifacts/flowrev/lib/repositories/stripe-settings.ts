import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

export type StripeSettingsTier = "client" | "white_label" | "hq";

export interface StripeSettingsMasked {
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  isLive: boolean;
  /** どの階層の設定を表示しているか（クライアント自身の設定でない場合、編集画面側で継承表示に使う） */
  tier: StripeSettingsTier;
}

export interface StripeSettingsResolved {
  secretKey: string;
  webhookSecret: string | null;
  isLive: boolean;
  tier: StripeSettingsTier;
}

export interface UpsertStripeSettingsInput {
  secretKey?: string;
  webhookSecret?: string;
  isLive?: boolean;
}

const STRIPE_ACCOUNT_COLUMNS = "access_token_enc, webhook_secret_enc, is_live";

async function getClientWhiteLabelId(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("clients")
    .select("white_label_id")
    .eq("id", clientId)
    .maybeSingle();
  return (data as Record<string, unknown> | null)?.white_label_id as
    | string
    | null;
}

/**
 * クライアント→WL→HQの順でStripe設定を解決する（`getActiveAiSetting`/`getLineSettingsResolved`と
 * 同じ3階層パターン）。見つかった階層の生データとtierを返す。呼び出し側でマスク/復号する。
 */
async function resolveStripeAccountRow(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
): Promise<{ row: Record<string, unknown>; tier: StripeSettingsTier } | null> {
  const { data: clientRow, error: clientError } = await admin
    .from("stripe_accounts")
    .select(STRIPE_ACCOUNT_COLUMNS)
    .eq("client_id", clientId)
    .maybeSingle();
  if (clientError) throwSafe("Stripe設定の取得に失敗", clientError);
  if (clientRow) return { row: clientRow as Record<string, unknown>, tier: "client" };

  const whiteLabelId = await getClientWhiteLabelId(admin, clientId);
  if (whiteLabelId) {
    const { data: wlRow, error: wlError } = await admin
      .from("stripe_accounts")
      .select(STRIPE_ACCOUNT_COLUMNS)
      .is("client_id", null)
      .eq("white_label_id", whiteLabelId)
      .maybeSingle();
    if (wlError) throwSafe("Stripe設定の取得に失敗", wlError);
    if (wlRow) return { row: wlRow as Record<string, unknown>, tier: "white_label" };
  }

  const { data: hqRow, error: hqError } = await admin
    .from("stripe_accounts")
    .select(STRIPE_ACCOUNT_COLUMNS)
    .is("client_id", null)
    .is("white_label_id", null)
    .maybeSingle();
  if (hqError) throwSafe("Stripe設定の取得に失敗", hqError);
  if (hqRow) return { row: hqRow as Record<string, unknown>, tier: "hq" };

  return null;
}

/** 管理画面表示用：クライアント→WL→HQの順で解決し、キーをマスクして返す */
export async function getStripeSettingsMasked(
  clientId: string,
): Promise<StripeSettingsMasked | null> {
  const admin = createAdminClient();
  const resolved = await resolveStripeAccountRow(admin, clientId);
  if (!resolved) return null;

  const { row, tier } = resolved;
  return {
    hasSecretKey: !!(row.access_token_enc as string),
    hasWebhookSecret: !!(row.webhook_secret_enc as string),
    isLive: !!(row.is_live as boolean),
    tier,
  };
}

/** API呼び出し用：クライアント→WL→HQの順で解決し、復号済みキーを返す */
export async function getStripeSettingsResolved(
  clientId: string,
): Promise<StripeSettingsResolved | null> {
  const admin = createAdminClient();
  const resolved = await resolveStripeAccountRow(admin, clientId);
  if (!resolved) return null;

  const { row, tier } = resolved;
  if (!row.access_token_enc) return null;

  return {
    secretKey: decrypt(row.access_token_enc as string),
    webhookSecret: row.webhook_secret_enc
      ? decrypt(row.webhook_secret_enc as string)
      : null,
    isLive: !!(row.is_live as boolean),
    tier,
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
  const whiteLabelId = await getClientWhiteLabelId(admin, clientId);

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

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface CloudflareSettingsMasked {
  accountId: string | null;
  hasApiToken: boolean;
  hasWebhookSecret: boolean;
  alertEmails: string | null;
  lastCheckedAt: string | null;
  lastAlertedAt: string | null;
  lastUnprotectedCount: number | null;
}

export interface CloudflareSettingsResolved {
  accountId: string;
  apiToken: string;
  webhookSecret?: string;
  alertEmails?: string | null;
}

export interface UpsertCloudflareSettingsInput {
  accountId?: string;
  apiToken?: string;
  webhookSecret?: string;
  alertEmails?: string | null;
}

/** 管理画面用：API トークンと Webhook シークレットをマスクして返す */
export async function getCloudflareSettingsMasked(): Promise<CloudflareSettingsMasked | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloudflare_settings")
    .select(
      "account_id, api_token_enc, webhook_secret_enc, alert_emails, last_checked_at, last_alerted_at, last_unprotected_count",
    )
    .limit(1)
    .maybeSingle();

  if (error) throwSafe("Cloudflare設定の取得に失敗", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    accountId: (row.account_id as string) ?? null,
    hasApiToken: !!(row.api_token_enc as string),
    hasWebhookSecret: !!(row.webhook_secret_enc as string),
    alertEmails: (row.alert_emails as string) ?? null,
    lastCheckedAt: (row.last_checked_at as string) ?? null,
    lastAlertedAt: (row.last_alerted_at as string) ?? null,
    lastUnprotectedCount:
      row.last_unprotected_count != null
        ? (row.last_unprotected_count as number)
        : null,
  };
}

/** 動画アップロード API 用：復号済み設定を返す */
export async function getCloudflareSettingsResolved(): Promise<CloudflareSettingsResolved | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloudflare_settings")
    .select("account_id, api_token_enc, webhook_secret_enc, alert_emails")
    .limit(1)
    .maybeSingle();

  if (error) throwSafe("Cloudflare設定の取得に失敗", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  if (!row.account_id || !row.api_token_enc) return null;

  return {
    accountId: row.account_id as string,
    apiToken: decrypt(row.api_token_enc as string),
    webhookSecret: row.webhook_secret_enc
      ? decrypt(row.webhook_secret_enc as string)
      : undefined,
    alertEmails: (row.alert_emails as string) ?? null,
  };
}

/** Cloudflare Webhook シークレットのみ復号して返す（Webhook ルート用） */
export async function getCloudflareWebhookSecret(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloudflare_settings")
    .select("webhook_secret_enc")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[CF Webhook] シークレット取得エラー:", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  if (!row.webhook_secret_enc) return null;

  return decrypt(row.webhook_secret_enc as string);
}

export interface UpdateCronTimestampsInput {
  lastCheckedAt: string;
  lastAlertedAt?: string;
  lastUnprotectedCount: number;
}

/**
 * cron 実行後に last_checked_at / last_alerted_at / last_unprotected_count を更新する。
 * cloudflare_settings 行が存在する場合のみ更新（存在しない場合はスキップ）。
 */
export async function updateCronTimestamps(
  input: UpdateCronTimestampsInput,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("cloudflare_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!existing) return;

  const existingRow = existing as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    last_checked_at: input.lastCheckedAt,
    last_unprotected_count: input.lastUnprotectedCount,
    updated_at: new Date().toISOString(),
  };
  if (input.lastAlertedAt !== undefined) {
    payload.last_alerted_at = input.lastAlertedAt;
  }

  const { error } = await admin
    .from("cloudflare_settings")
    .update(payload)
    .eq("id", existingRow.id as string);

  if (error) {
    console.error(`[Cron] タイムスタンプ更新エラー: ${error.message}`);
  }
}

/** Cloudflare 設定を upsert する（最大 1 行） */
export async function upsertCloudflareSettings(
  input: UpsertCloudflareSettingsInput,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("cloudflare_settings")
    .select("id, account_id, api_token_enc, webhook_secret_enc, alert_emails")
    .limit(1)
    .maybeSingle();

  const existingRow = existing as Record<string, unknown> | null;
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.accountId !== undefined) {
    payload.account_id = input.accountId || null;
  } else if (existingRow?.account_id) {
    payload.account_id = existingRow.account_id;
  }

  if (input.apiToken) {
    payload.api_token_enc = encrypt(input.apiToken);
  } else if (existingRow?.api_token_enc) {
    payload.api_token_enc = existingRow.api_token_enc;
  }

  if (input.webhookSecret) {
    payload.webhook_secret_enc = encrypt(input.webhookSecret);
  } else if (existingRow?.webhook_secret_enc) {
    payload.webhook_secret_enc = existingRow.webhook_secret_enc;
  }

  if (input.alertEmails !== undefined) {
    payload.alert_emails = input.alertEmails;
  } else if (existingRow?.alert_emails) {
    payload.alert_emails = existingRow.alert_emails;
  }

  if (existingRow) {
    const { error } = await admin
      .from("cloudflare_settings")
      .update(payload)
      .eq("id", existingRow.id as string);
    if (error) throwSafe("Cloudflare設定の更新に失敗", error);
  } else {
    const { error } = await admin.from("cloudflare_settings").insert(payload);
    if (error) throwSafe("Cloudflare設定の作成に失敗", error);
  }
}

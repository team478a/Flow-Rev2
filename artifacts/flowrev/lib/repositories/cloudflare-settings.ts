import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

export type CloudflareSettingsTier = "client" | "white_label" | "hq";

export interface CloudflareSettingsMasked {
  accountId: string | null;
  hasApiToken: boolean;
  hasWebhookSecret: boolean;
  alertEmails: string | null;
  lastCheckedAt: string | null;
  lastAlertedAt: string | null;
  lastUnprotectedCount: number | null;
  /** どの階層の設定を表示しているか */
  tier: CloudflareSettingsTier;
}

export interface CloudflareSettingsResolved {
  accountId: string;
  apiToken: string;
  webhookSecret?: string;
  alertEmails?: string | null;
  tier: CloudflareSettingsTier;
}

export interface UpsertCloudflareSettingsInput {
  accountId?: string;
  apiToken?: string;
  webhookSecret?: string;
  alertEmails?: string | null;
}

const CLOUDFLARE_COLUMNS =
  "account_id, api_token_enc, webhook_secret_enc, alert_emails, last_checked_at, last_alerted_at, last_unprotected_count";

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
 * クライアント→WL→HQの順でCloudflare設定を解決する（`getActiveAiSetting`/
 * `resolveLineAccountRow`/`resolveStripeAccountRow`と同じ3階層パターン）。
 *
 * `clientId` を渡さない場合はHQ共通行のみを対象とする。テナント文脈を持たない
 * 呼び出し元（Webhook受信・Cron・system_admin向け管理画面）が該当する。
 */
async function resolveCloudflareSettingRow(
  admin: ReturnType<typeof createAdminClient>,
  clientId?: string,
): Promise<{
  row: Record<string, unknown>;
  tier: CloudflareSettingsTier;
} | null> {
  if (clientId) {
    const { data: clientRow, error: clientError } = await admin
      .from("cloudflare_settings")
      .select(CLOUDFLARE_COLUMNS)
      .eq("client_id", clientId)
      .maybeSingle();
    if (clientError) throwSafe("Cloudflare設定の取得に失敗", clientError);
    if (clientRow)
      return { row: clientRow as Record<string, unknown>, tier: "client" };

    const whiteLabelId = await getClientWhiteLabelId(admin, clientId);
    if (whiteLabelId) {
      const { data: wlRow, error: wlError } = await admin
        .from("cloudflare_settings")
        .select(CLOUDFLARE_COLUMNS)
        .is("client_id", null)
        .eq("white_label_id", whiteLabelId)
        .maybeSingle();
      if (wlError) throwSafe("Cloudflare設定の取得に失敗", wlError);
      if (wlRow)
        return { row: wlRow as Record<string, unknown>, tier: "white_label" };
    }
  }

  const { data: hqRow, error: hqError } = await admin
    .from("cloudflare_settings")
    .select(CLOUDFLARE_COLUMNS)
    .is("client_id", null)
    .is("white_label_id", null)
    .maybeSingle();
  if (hqError) throwSafe("Cloudflare設定の取得に失敗", hqError);
  if (hqRow) return { row: hqRow as Record<string, unknown>, tier: "hq" };

  return null;
}

/**
 * 管理画面用：API トークンと Webhook シークレットをマスクして返す。
 * `clientId` 未指定時はHQ共通設定を返す（system_admin向け画面の従来挙動）。
 */
export async function getCloudflareSettingsMasked(
  clientId?: string,
): Promise<CloudflareSettingsMasked | null> {
  const admin = createAdminClient();
  const resolved = await resolveCloudflareSettingRow(admin, clientId);
  if (!resolved) return null;

  const { row, tier } = resolved;
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
    tier,
  };
}

/**
 * 動画アップロード・再生 API 用：復号済み設定を返す。
 * `clientId` を渡すとクライアント→WL→HQの順で解決する。
 */
export async function getCloudflareSettingsResolved(
  clientId?: string,
): Promise<CloudflareSettingsResolved | null> {
  const admin = createAdminClient();
  const resolved = await resolveCloudflareSettingRow(admin, clientId);
  if (!resolved) return null;

  const { row, tier } = resolved;
  if (!row.account_id || !row.api_token_enc) return null;

  return {
    accountId: row.account_id as string,
    apiToken: decrypt(row.api_token_enc as string),
    webhookSecret: row.webhook_secret_enc
      ? decrypt(row.webhook_secret_enc as string)
      : undefined,
    alertEmails: (row.alert_emails as string) ?? null,
    tier,
  };
}

/**
 * Cloudflare Webhook シークレットのみ復号して返す（Webhook ルート用）。
 *
 * Webhook受信時点ではテナントを特定できない（署名検証はペイロードを信頼する前に
 * 行う必要があり、ペイロード内の動画IDからテナントを引くと検証順序が逆転する）ため、
 * 意図的にHQ共通設定のみを参照する。WL/クライアント単位のCloudflareアカウントを
 * 実際に運用する場合は、Webhookのテナント振り分け方式を別途設計する必要がある。
 */
export async function getCloudflareWebhookSecret(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloudflare_settings")
    .select("webhook_secret_enc")
    .is("client_id", null)
    .is("white_label_id", null)
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
 * HQ共通行が存在する場合のみ更新（存在しない場合はスキップ）。
 *
 * Cron自体がテナント単位で動作しないため、対象はHQ共通行に限定する
 * （`getCloudflareSettingsResolved()` を引数なしで呼ぶ側と対象行を一致させる）。
 */
export async function updateCronTimestamps(
  input: UpdateCronTimestampsInput,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("cloudflare_settings")
    .select("id")
    .is("client_id", null)
    .is("white_label_id", null)
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

/**
 * Cloudflare 設定を upsert する（HQ共通行のみ、最大 1 行）。
 *
 * 呼び出し元は system_admin 専用の管理画面（/admin/settings/cloudflare・
 * /admin/settings/video）のみで、いずれもHQ共通設定を編集する画面である。
 * WL/クライアント単位の行を作成するUIは本タスクのスコープ外のため、
 * 書き込み対象を明示的にHQ共通行へ限定する（0015・0016と同じ方針）。
 */
export async function upsertCloudflareSettings(
  input: UpsertCloudflareSettingsInput,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("cloudflare_settings")
    .select("id, account_id, api_token_enc, webhook_secret_enc, alert_emails")
    .is("client_id", null)
    .is("white_label_id", null)
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

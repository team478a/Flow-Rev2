import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

export type LineSettingsTier = "client" | "white_label" | "hq";

export interface LineSettingsMasked {
  hasChannelAccessToken: boolean;
  hasChannelSecret: boolean;
  lineFriendUrl: string | null;
  /** どの階層の設定を表示しているか（クライアント自身の設定でない場合、編集画面側で継承表示に使う） */
  tier: LineSettingsTier;
}

export interface LineSettingsResolved {
  channelAccessToken: string;
  channelSecret: string | null;
  lineFriendUrl: string | null;
  tier: LineSettingsTier;
}

export interface UpsertLineSettingsInput {
  channelAccessToken?: string;
  channelSecret?: string;
  lineFriendUrl?: string | null;
}

const LINE_ACCOUNT_COLUMNS =
  "channel_access_token_enc, channel_secret_enc, line_friend_url";

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
 * クライアント→WL→HQの順でLINE設定を解決する（`getActiveAiSetting`/`getActiveEmailSetting`と同じ3階層パターン）。
 * 見つかった階層の生データとtierを返す。呼び出し側でマスク/復号する。
 */
async function resolveLineAccountRow(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
): Promise<{ row: Record<string, unknown>; tier: LineSettingsTier } | null> {
  const { data: clientRow, error: clientError } = await admin
    .from("line_accounts")
    .select(LINE_ACCOUNT_COLUMNS)
    .eq("client_id", clientId)
    .maybeSingle();
  if (clientError) throwSafe("LINE設定の取得に失敗", clientError);
  if (clientRow) return { row: clientRow as Record<string, unknown>, tier: "client" };

  const whiteLabelId = await getClientWhiteLabelId(admin, clientId);
  if (whiteLabelId) {
    const { data: wlRow, error: wlError } = await admin
      .from("line_accounts")
      .select(LINE_ACCOUNT_COLUMNS)
      .is("client_id", null)
      .eq("white_label_id", whiteLabelId)
      .maybeSingle();
    if (wlError) throwSafe("LINE設定の取得に失敗", wlError);
    if (wlRow) return { row: wlRow as Record<string, unknown>, tier: "white_label" };
  }

  const { data: hqRow, error: hqError } = await admin
    .from("line_accounts")
    .select(LINE_ACCOUNT_COLUMNS)
    .is("client_id", null)
    .is("white_label_id", null)
    .maybeSingle();
  if (hqError) throwSafe("LINE設定の取得に失敗", hqError);
  if (hqRow) return { row: hqRow as Record<string, unknown>, tier: "hq" };

  return null;
}

/** 管理画面表示用：クライアント→WL→HQの順で解決し、トークンをマスクして返す */
export async function getLineSettingsMasked(
  clientId: string,
): Promise<LineSettingsMasked | null> {
  const admin = createAdminClient();
  const resolved = await resolveLineAccountRow(admin, clientId);
  if (!resolved) return null;

  const { row, tier } = resolved;
  return {
    hasChannelAccessToken: !!(row.channel_access_token_enc as string),
    hasChannelSecret: !!(row.channel_secret_enc as string),
    lineFriendUrl: (row.line_friend_url as string) ?? null,
    tier,
  };
}

/** LINE 送信用：クライアント→WL→HQの順で解決し、復号済みトークンを返す */
export async function getLineSettingsResolved(
  clientId: string,
): Promise<LineSettingsResolved | null> {
  const admin = createAdminClient();
  const resolved = await resolveLineAccountRow(admin, clientId);
  if (!resolved) return null;

  const { row, tier } = resolved;
  if (!row.channel_access_token_enc) return null;

  return {
    channelAccessToken: decrypt(row.channel_access_token_enc as string),
    channelSecret: row.channel_secret_enc
      ? decrypt(row.channel_secret_enc as string)
      : null,
    lineFriendUrl: (row.line_friend_url as string) ?? null,
    tier,
  };
}

/** LINE 設定を upsert する */
export async function upsertLineSettings(
  clientId: string,
  input: UpsertLineSettingsInput,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("line_accounts")
    .select("id, channel_access_token_enc, channel_secret_enc")
    .eq("client_id", clientId)
    .maybeSingle();

  const existingRow = existing as Record<string, unknown> | null;
  const whiteLabelId = await getClientWhiteLabelId(admin, clientId);

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.channelAccessToken) {
    payload.channel_access_token_enc = encrypt(input.channelAccessToken);
  } else if (existingRow?.channel_access_token_enc) {
    payload.channel_access_token_enc = existingRow.channel_access_token_enc;
  }

  if (input.channelSecret) {
    payload.channel_secret_enc = encrypt(input.channelSecret);
  } else if (existingRow?.channel_secret_enc) {
    payload.channel_secret_enc = existingRow.channel_secret_enc;
  }

  if ("lineFriendUrl" in input) {
    payload.line_friend_url = input.lineFriendUrl ?? null;
  }

  if (existingRow) {
    const { error } = await admin
      .from("line_accounts")
      .update(payload)
      .eq("client_id", clientId);
    if (error) throwSafe("LINE設定の更新に失敗", error);
  } else {
    const { error } = await admin.from("line_accounts").insert({
      ...payload,
      client_id: clientId,
      white_label_id: whiteLabelId,
    });
    if (error) throwSafe("LINE設定の作成に失敗", error);
  }
}

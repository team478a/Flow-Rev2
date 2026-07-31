import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface LineSettingsMasked {
  hasChannelAccessToken: boolean;
  hasChannelSecret: boolean;
  lineFriendUrl: string | null;
}

export interface LineSettingsResolved {
  channelAccessToken: string;
  channelSecret: string | null;
  lineFriendUrl: string | null;
}

export interface UpsertLineSettingsInput {
  channelAccessToken?: string;
  channelSecret?: string;
  lineFriendUrl?: string | null;
}

/** 管理画面表示用：トークンをマスクして返す */
export async function getLineSettingsMasked(
  clientId: string,
): Promise<LineSettingsMasked | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("line_accounts")
    .select("channel_access_token_enc, channel_secret_enc, line_friend_url")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throwSafe("LINE設定の取得に失敗", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    hasChannelAccessToken: !!(row.channel_access_token_enc as string),
    hasChannelSecret: !!(row.channel_secret_enc as string),
    lineFriendUrl: (row.line_friend_url as string) ?? null,
  };
}

/** LINE 送信用：復号済みトークンを返す */
export async function getLineSettingsResolved(
  clientId: string,
): Promise<LineSettingsResolved | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("line_accounts")
    .select("channel_access_token_enc, channel_secret_enc, line_friend_url")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throwSafe("LINE設定の取得に失敗", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  if (!row.channel_access_token_enc) return null;

  return {
    channelAccessToken: decrypt(row.channel_access_token_enc as string),
    channelSecret: row.channel_secret_enc
      ? decrypt(row.channel_secret_enc as string)
      : null,
    lineFriendUrl: (row.line_friend_url as string) ?? null,
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

  const { data: clientRow } = await admin
    .from("clients")
    .select("white_label_id")
    .eq("id", clientId)
    .maybeSingle();
  const whiteLabelId = (clientRow as Record<string, unknown> | null)?.white_label_id as string | null;

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

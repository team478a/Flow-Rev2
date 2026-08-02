"use server";

import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { upsertLineSettingsForWhiteLabel } from "@/lib/repositories/line-settings";
import { upsertStripeSettingsForWhiteLabel } from "@/lib/repositories/stripe-settings";

export interface WlSettingsActionResult {
  error: string | null;
}

/**
 * OEM共通のLINE設定を保存する。
 *
 * 対象は常に「自分のOEMの行」であり、`white_label_id` はセッションから取得する。
 * フォームから受け取ることはしない（他OEMのIDを送られても書き換えられないようにするため）。
 */
export async function saveWlLineSettingsAction(
  formData: FormData,
): Promise<WlSettingsActionResult> {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return { error: "OEM情報が取得できません。" };
  }

  const channelAccessToken = (
    (formData.get("channelAccessToken") as string | null) ?? ""
  ).trim();
  const channelSecret = (
    (formData.get("channelSecret") as string | null) ?? ""
  ).trim();
  const lineFriendUrl = (
    (formData.get("lineFriendUrl") as string | null) ?? ""
  ).trim();

  try {
    await upsertLineSettingsForWhiteLabel(session.whiteLabelId, {
      channelAccessToken: channelAccessToken || undefined,
      channelSecret: channelSecret || undefined,
      lineFriendUrl: lineFriendUrl || null,
    });
    return { error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました。";
    return { error: msg };
  }
}

/**
 * OEM共通のStripe設定を保存する。
 * LINE同様、対象OEMはセッションから決定する。
 */
export async function saveWlStripeSettingsAction(
  formData: FormData,
): Promise<WlSettingsActionResult> {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return { error: "OEM情報が取得できません。" };
  }

  const secretKey = ((formData.get("secretKey") as string | null) ?? "").trim();
  const webhookSecret = (
    (formData.get("webhookSecret") as string | null) ?? ""
  ).trim();
  const isLive = formData.get("isLive") === "true";

  try {
    await upsertStripeSettingsForWhiteLabel(session.whiteLabelId, {
      secretKey: secretKey || undefined,
      webhookSecret: webhookSecret || undefined,
      isLive,
    });
    return { error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました。";
    return { error: msg };
  }
}

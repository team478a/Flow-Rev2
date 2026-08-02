"use server";

import { revalidatePath } from "next/cache";
import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { upsertLineSettingsForWhiteLabel } from "@/lib/repositories/line-settings";
import { upsertStripeSettingsForWhiteLabel } from "@/lib/repositories/stripe-settings";
import {
  getWlAiSettingMasked,
  upsertWlAiSetting,
  updateWlAiSettingModel,
  type AiProvider,
} from "@/lib/repositories/ai-settings";
import {
  getWlEmailSettingMasked,
  upsertWlEmailSetting,
  updateWlEmailSettingProfile,
} from "@/lib/repositories/email-settings";
import { upsertCloudflareSettingsForWhiteLabel } from "@/lib/repositories/cloudflare-settings";

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

/**
 * OEM共通のAI設定を保存する。
 * `provider` はフォームから受け取るが、対象OEMは常にセッションから決定する。
 */
async function saveWlAiSettingFor(
  provider: AiProvider,
  formData: FormData,
): Promise<{ error: string | null; success?: boolean }> {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return { error: "OEM情報が取得できません。" };
  }

  const apiKey = ((formData.get("apiKey") as string | null) ?? "").trim();
  const model = ((formData.get("model") as string | null) ?? "").trim();

  const current = await getWlAiSettingMasked(session.whiteLabelId, provider);
  if (!apiKey && !current?.hasApiKey) {
    return { error: "API キーを入力してください。" };
  }

  try {
    if (apiKey) {
      await upsertWlAiSetting(session.whiteLabelId, {
        provider,
        apiKey,
        model: model || undefined,
      });
    } else {
      // キーは変更せずモデル名のみ更新する
      await updateWlAiSettingModel(
        session.whiteLabelId,
        provider,
        model || null,
      );
    }
    revalidatePath("/wl/settings/ai");
    return { error: null, success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました。";
    return { error: msg };
  }
}

/** OEM共通のAnthropic設定を保存する。 */
export async function saveWlAnthropicSettingAction(
  _prev: { error: string | null; success?: boolean },
  formData: FormData,
): Promise<{ error: string | null; success?: boolean }> {
  return saveWlAiSettingFor("anthropic", formData);
}

/** OEM共通のOpenAI設定を保存する。 */
export async function saveWlOpenAiSettingAction(
  _prev: { error: string | null; success?: boolean },
  formData: FormData,
): Promise<{ error: string | null; success?: boolean }> {
  return saveWlAiSettingFor("openai", formData);
}

/** OEM共通のメール（Resend）設定を保存する。 */
export async function saveWlEmailSettingAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData,
): Promise<{ error: string | null; success: boolean }> {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return { error: "OEM情報が取得できません。", success: false };
  }

  const apiKey = ((formData.get("apiKey") as string | null) ?? "").trim();
  const fromEmail = ((formData.get("fromEmail") as string | null) ?? "").trim();
  const fromName = ((formData.get("fromName") as string | null) ?? "").trim();

  if (!fromEmail) {
    return { error: "送信元メールアドレスを入力してください。", success: false };
  }

  const current = await getWlEmailSettingMasked(session.whiteLabelId);
  if (!apiKey && !current?.hasApiKey) {
    return { error: "API キーを入力してください。", success: false };
  }

  try {
    if (apiKey) {
      await upsertWlEmailSetting(session.whiteLabelId, {
        apiKey,
        fromEmail,
        fromName: fromName || undefined,
      });
    } else {
      // キー未入力時は既存キーを維持し、送信元情報だけを更新する。
      // 空文字を暗号化して保存すると既存キーを壊してしまうため。
      await updateWlEmailSettingProfile(
        session.whiteLabelId,
        fromEmail,
        fromName || null,
      );
    }
    revalidatePath("/wl/settings/email");
    return { error: null, success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました。";
    return { error: msg, success: false };
  }
}

/** OEM共通のCloudflare設定を保存する。 */
export async function saveWlCloudflareSettingAction(
  _prev: { error: string | null; success?: boolean },
  formData: FormData,
): Promise<{ error: string | null; success?: boolean }> {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return { error: "OEM情報が取得できません。" };
  }

  const accountId = ((formData.get("accountId") as string | null) ?? "").trim();
  const apiToken = ((formData.get("apiToken") as string | null) ?? "").trim();
  const webhookSecret = (
    (formData.get("webhookSecret") as string | null) ?? ""
  ).trim();

  try {
    await upsertCloudflareSettingsForWhiteLabel(session.whiteLabelId, {
      accountId,
      apiToken: apiToken || undefined,
      webhookSecret: webhookSecret || undefined,
    });
    revalidatePath("/wl/settings/cloudflare");
    return { error: null, success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました。";
    return { error: msg };
  }
}

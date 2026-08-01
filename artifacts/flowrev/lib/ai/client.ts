import Anthropic from "@anthropic-ai/sdk";
import { getActiveAiSetting } from "@/lib/repositories/ai-settings";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;
const LP_MAX_TOKENS = 6000;

/**
 * DB に保存された API キーを使って Anthropic でテキストを生成する。
 * server-side（API Route / Server Action）からのみ呼び出す。
 * whiteLabelId を渡すと、WL個別のAI設定 → HQ共通設定の順で解決する。
 */
export async function generateText(
  prompt: string,
  whiteLabelId?: string | null,
): Promise<string> {
  const setting = await getActiveAiSetting("anthropic", whiteLabelId);
  if (!setting) {
    throw new Error(
      "AI API キーが設定されていません。管理者へお問い合わせください。",
    );
  }

  const client = new Anthropic({ apiKey: setting.apiKey });
  const message = await client.messages.create({
    model: setting.model ?? DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (!block || block.type !== "text") {
    throw new Error("AI からの応答が取得できませんでした。");
  }
  return block.text;
}

/**
 * LP HTML 専用の生成関数。トークン上限を大きく取る。
 * server-side（API Route）からのみ呼び出す。
 * whiteLabelId を渡すと、WL個別のAI設定 → HQ共通設定の順で解決する。
 */
export async function generateLpHtml(
  prompt: string,
  whiteLabelId?: string | null,
): Promise<string> {
  const setting = await getActiveAiSetting("anthropic", whiteLabelId);
  if (!setting) {
    throw new Error(
      "AI API キーが設定されていません。管理者へお問い合わせください。",
    );
  }

  const client = new Anthropic({ apiKey: setting.apiKey });
  const message = await client.messages.create({
    model: setting.model ?? DEFAULT_MODEL,
    max_tokens: LP_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (!block || block.type !== "text") {
    throw new Error("AI からの応答が取得できませんでした。");
  }
  return block.text;
}

/** 商品説明文を生成するプロンプトを構築する。 */
export function buildProductPrompt(name: string, category: string): string {
  return `以下の商品・サービスの説明文を日本語で200字程度で作成してください。
ターゲット顧客が購買意欲を持てるよう、具体的なベネフィットを含めてください。
箇条書きは使わず、文章で記述してください。

商品名: ${name}
カテゴリ: ${category || "未設定"}

説明文のみを返してください（前置き・後書きは不要）。`;
}

/** フォローメッセージ（メール本文）を生成するプロンプトを構築する。 */
export function buildFollowPrompt(subject: string, scenarioName: string): string {
  return `以下のフォローメールの本文を日本語で作成してください。
親しみやすく、行動を促す文章にしてください。200〜300字程度。

メールの件名: ${subject || "フォローアップ"}
シナリオ名: ${scenarioName || "未設定"}

本文のみを返してください（前置き・後書きは不要）。`;
}

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { getActiveAiSetting } from "@/lib/repositories/ai-settings";
import { uploadLpImage, getLpImagePublicUrl } from "@/lib/storage";
import { checkAiGenerationLimit } from "@/lib/rate-limit";

const DALLE_MODEL = "dall-e-3";
const IMAGE_SIZE = "1024x1024" as const;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const rateLimit = await checkAiGenerationLimit(user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "AI生成のリクエストが多すぎます。しばらく待ってから再度お試しください。" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } },
    );
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body.prompt ?? "").trim();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json({ error: "画像の説明を入力してください。" }, { status: 400 });
  }

  const setting = await getActiveAiSetting("openai");
  if (!setting) {
    return NextResponse.json(
      { error: "OpenAI API キーが設定されていません。管理者設定でキーを登録してください。" },
      { status: 503 },
    );
  }

  try {
    // DALL-E 3 で画像を生成
    const openai = new OpenAI({ apiKey: setting.apiKey });
    const response = await openai.images.generate({
      model: DALLE_MODEL,
      prompt: `${prompt}。日本語のランディングページ用の画像。`,
      n: 1,
      size: IMAGE_SIZE,
      response_format: "url",
    });

    const tempUrl = response.data?.[0]?.url;
    if (!tempUrl) {
      return NextResponse.json({ error: "画像の生成に失敗しました。" }, { status: 500 });
    }

    // 生成された画像を取得して Supabase Storage に永続保存
    const imgRes = await fetch(tempUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: "生成画像の取得に失敗しました。" }, { status: 500 });
    }
    const buffer = await imgRes.arrayBuffer();
    const path = await uploadLpImage(buffer, "image/png", user.id);
    const url = getLpImagePublicUrl(path);

    return NextResponse.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "画像生成に失敗しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

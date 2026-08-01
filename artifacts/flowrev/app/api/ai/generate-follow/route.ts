import { NextRequest, NextResponse } from "next/server";
import { getSessionProfile } from "@/features/auth/session";
import { generateText, buildFollowPrompt } from "@/lib/ai/client";
import { checkAiGenerationLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const rateLimit = await checkAiGenerationLimit(session.userId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "AI生成のリクエストが多すぎます。しばらく待ってから再度お試しください。" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } },
    );
  }

  let subject = "";
  let scenarioName = "";
  try {
    const body = await req.json();
    subject = String(body.subject ?? "").trim();
    scenarioName = String(body.scenarioName ?? "").trim();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }

  try {
    const text = await generateText(
      buildFollowPrompt(subject, scenarioName),
      session.whiteLabelId,
    );
    return NextResponse.json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "生成に失敗しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionProfile } from "@/features/auth/session";
import { getCloudflareSettingsResolved } from "@/lib/repositories/cloudflare-settings";

const CF_STREAM_BASE = "https://api.cloudflare.com/client/v4/accounts";
const ALLOWED_ROLES = ["client_owner", "system_admin"] as const;

/**
 * POST /api/admin/video/upload-url
 * Cloudflare Stream の TUS アップロード URL を生成する。
 * client_owner / system_admin のみ利用可能。
 * Body: { fileSize: number, filename: string }
 * Response: { uploadUrl: string, videoId: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (!session.role || !(ALLOWED_ROLES as readonly string[]).includes(session.role)) {
    return NextResponse.json({ error: "この操作を行う権限がありません。" }, { status: 403 });
  }

  let fileSize: number;
  let filename: string;
  try {
    const body = await req.json();
    fileSize = Number(body.fileSize);
    filename = String(body.filename ?? "video");
    if (!fileSize || fileSize <= 0) throw new Error("fileSize が無効です。");
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const settings = await getCloudflareSettingsResolved().catch(() => null);
  if (!settings) {
    return NextResponse.json(
      { error: "Cloudflare Stream が設定されていません。管理者にお問い合わせください。" },
      { status: 503 },
    );
  }

  const encodedName = Buffer.from(filename).toString("base64");
  const url = `${CF_STREAM_BASE}/${settings.accountId}/stream?direct_user=true`;

  const cfRes = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiToken}`,
      "Content-Length": "0",
      "Upload-Length": String(fileSize),
      "Tus-Resumable": "1.0.0",
      "Upload-Metadata": `name ${encodedName},requiresignedurls`,
    },
  });

  if (!cfRes.ok) {
    const body = await cfRes.text().catch(() => "");
    console.error(`[upload-url] Cloudflare API エラー (${cfRes.status}): ${body}`);
    return NextResponse.json(
      { error: "Cloudflareへのアップロード準備に失敗しました。" },
      { status: 502 },
    );
  }

  const uploadUrl = cfRes.headers.get("Location") ?? "";
  const videoId = cfRes.headers.get("stream-media-id") ?? "";

  if (!uploadUrl || !videoId) {
    return NextResponse.json(
      { error: "Cloudflare からアップロード URL を取得できませんでした。" },
      { status: 502 },
    );
  }

  return NextResponse.json({ uploadUrl, videoId });
}

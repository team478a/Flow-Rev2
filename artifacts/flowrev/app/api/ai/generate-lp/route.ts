import { NextRequest, NextResponse } from "next/server";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getSessionProfile } from "@/features/auth/session";
import { generateLpHtml } from "@/lib/ai/client";
import {
  generateLpCss,
  buildDesignedLpPrompt,
  isValidHexColor,
  type LpColorConfig,
} from "@/lib/ai/lp-design-system";
import { checkAiGenerationLimit } from "@/lib/rate-limit";

const REFERENCE_MAX_CHARS = 3000;
const FETCH_TIMEOUT_MS = 8000;

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** IPv4アドレスがプライベート／予約済みレンジ（内部ネットワーク・メタデータ等）かどうか */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a >= 224) return true; // マルチキャスト・予約済み
  return false;
}

/** IPv6アドレスがプライベート／予約済みレンジかどうか（簡易判定） */
function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  // IPv4-mapped / IPv4-compatible IPv6 は内包する IPv4 アドレスを判定する
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateOrReservedIPv4(ip);
  if (family === 6) return isPrivateOrReservedIPv6(ip);
  return true; // 判定不能なものは安全側に倒して拒否
}

/**
 * SSRF対策: http(s) 以外のスキーム、および参照先ホストが解決するIPアドレスが
 * プライベート/予約済みレンジ（社内ネットワーク・localhost・クラウドメタデータ
 * エンドポイント等）である場合は取得を拒否する。
 * 注: DNSリバインディング（判定後にDNS応答を切り替える攻撃）までは防げない。
 */
async function isSafeExternalUrl(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;

  try {
    const literalFamily = isIP(hostname);
    if (literalFamily) {
      return !isPrivateOrReservedIp(hostname);
    }
    const results = await dnsLookup(hostname, { all: true, verbatim: true });
    if (results.length === 0) return false;
    return results.every((r) => !isPrivateOrReservedIp(r.address));
  } catch {
    return false;
  }
}

async function fetchReferenceText(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (!(await isSafeExternalUrl(parsed))) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(parsed, {
      signal: controller.signal,
      redirect: "manual", // リダイレクト先の再検証を省略しないため自動追跡しない
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlowRevBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    const html = await res.text();
    return extractTextFromHtml(html).slice(0, REFERENCE_MAX_CHARS);
  } catch {
    return null;
  }
}

/** AI が出力するコードブロックマーカーを除去する */
function stripCodeFence(text: string): string {
  return text
    .replace(/^```[\w]*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();
}

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

  let title = "";
  let productName = "";
  let referenceUrl = "";
  let designStyleName = "モダン";
  let colorPrimary = "#2563eb";
  let colorBg = "#eff6ff";
  let colorAccent = "#1d4ed8";

  try {
    const body = await req.json();
    title = String(body.title ?? "").trim();
    productName = String(body.productName ?? "").trim();
    referenceUrl = String(body.referenceUrl ?? "").trim();
    if (body.designStyleName) designStyleName = String(body.designStyleName).trim();
    if (body.colorPrimary) colorPrimary = String(body.colorPrimary).trim();
    if (body.colorBg) colorBg = String(body.colorBg).trim();
    if (body.colorAccent) colorAccent = String(body.colorAccent).trim();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }

  // カラー値はCSSへ直接埋め込むため、16進カラー以外を拒否する（CSSインジェクション対策）。
  if (![colorPrimary, colorBg, colorAccent].every(isValidHexColor)) {
    return NextResponse.json(
      { error: "カラー値の形式が不正です。" },
      { status: 400 },
    );
  }

  if (!title) {
    return NextResponse.json(
      { error: "ページタイトルを入力してから生成してください。" },
      { status: 400 },
    );
  }

  let referenceContent: string | undefined;
  let referenceWarning: string | undefined;

  if (referenceUrl) {
    try {
      new URL(referenceUrl);
      const text = await fetchReferenceText(referenceUrl);
      if (text && text.length > 50) {
        referenceContent = text;
      } else {
        referenceWarning = "参考URLからテキストを取得できませんでした。通常の生成で続行します。";
      }
    } catch {
      referenceWarning = "参考URLの形式が正しくありません。通常の生成で続行します。";
    }
  }

  const color: LpColorConfig = { primary: colorPrimary, bg: colorBg, accent: colorAccent };
  const css = generateLpCss(color, designStyleName);
  const prompt = buildDesignedLpPrompt(title, productName, designStyleName, referenceContent);

  try {
    const rawHtml = await generateLpHtml(prompt, session.whiteLabelId);
    const bodyHtml = stripCodeFence(rawHtml);
    // text: 従来互換（HTML詳細編集フォームの自由入力欄向け、<style>込みの単一文字列）。
    // html/css/design: ウィザード用。CSSをHTML本文と分離して返し、保存時も別列に
    // 持たせることで、公開ページのサニタイザーが <style> タグを除去しても
    // デザインが失われないようにする（docs/audit/05_SECURITY_FINDINGS.md L-2）。
    const text = `<style>${css}</style>\n${bodyHtml}`;
    return NextResponse.json({
      text,
      html: bodyHtml,
      css,
      design: {
        styleName: designStyleName,
        colorPrimary,
        colorBg,
        colorAccent,
      },
      referenceWarning,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "生成に失敗しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

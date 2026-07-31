import "server-only";
import { createHash } from "crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * 固定ウィンドウ方式のレートリミット。
 * `rate_limits` テーブル（0004_payments.sql で定義済み、これまで未使用だった）を使う。
 *
 * 注: 読み取り→書き込みの間に厳密なトランザクション/ロックは行っていないため、
 * 同時リクエストが極めて密接なタイミングで来た場合に多少の超過を許してしまう
 * 可能性がある。ログイン試行・AI生成コストの濫用を「無制限」から「概ね制限内」
 * に抑えることが目的であり、完全な原子性は要求していない。
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const supabase = createAdminClient();
  const now = Date.now();

  const { data: row } = await supabase
    .from("rate_limits")
    .select("count, window_start")
    .eq("key", key)
    .maybeSingle();

  if (!row) {
    await supabase
      .from("rate_limits")
      .upsert(
        { key, count: 1, window_start: new Date(now).toISOString() },
        { onConflict: "key" },
      );
    return { allowed: true };
  }

  const windowStart = new Date(row.window_start as string).getTime();
  const elapsedSeconds = (now - windowStart) / 1000;

  if (elapsedSeconds >= windowSeconds) {
    await supabase
      .from("rate_limits")
      .update({ count: 1, window_start: new Date(now).toISOString() })
      .eq("key", key);
    return { allowed: true };
  }

  const count = (row.count as number) ?? 0;
  if (count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsedSeconds)),
    };
  }

  await supabase
    .from("rate_limits")
    .update({ count: count + 1 })
    .eq("key", key);

  return { allowed: true };
}

/**
 * リクエスト元IPアドレスを取得する（Vercel/プロキシ経由を想定し x-forwarded-for を使用）。
 * Server Actions（next/headers）とRoute Handlers（NextRequestのheaders）の両方から呼べるよう、
 * ヘッダー取得元を引数で受け取れるようにする。
 */
export function getClientIp(headerSource?: Headers): string {
  const h = headerSource ?? headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

/** メールアドレス等、生の値をレートリミットキーに含める際にハッシュ化する（PII対策） */
export function hashForRateLimitKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * AI生成系エンドポイント（テキスト・画像とも課金対象）共通のレートリミット。
 * ユーザー単位で5分間に20回まで（LP生成・画像生成・文章生成の全ルートで共有）。
 */
export function checkAiGenerationLimit(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(`ai:${userId}`, 20, 300);
}

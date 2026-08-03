import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

/**
 * Cloudflare Stream Webhook の署名検証の検証。
 *
 * このエンドポイントは外部からの通知で `lessons.cloudflare_video_status` を
 * 書き換える。検証が緩むと、任意の動画IDのステータスを外部から操作できる
 * （未完了の動画を ready に見せる、公開中の動画を error にする等）。
 *
 * 署名は `Webhook-Signature: ts=<秒>,v1=<HMAC-SHA256(secret, "ts.body")>` 形式。
 * Stripe と違い自前実装なので、HMACの計算方法そのものも検証対象になる。
 */

const SECRET = "cf_webhook_secret_for_tests";
const OTHER_SECRET = "cf_a_different_secret";
const VIDEO_ID = "abc123videouid";

const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
const insertWebhookLog = vi.fn(async () => undefined);

let dbSecret: string | null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ update }) }),
}));
vi.mock("@/lib/repositories/cloudflare-settings", () => ({
  getCloudflareWebhookSecret: async () => dbSecret,
}));
vi.mock("@/lib/repositories/cloudflare-webhook-logs", () => ({
  insertWebhookLog: (...args: unknown[]) => insertWebhookLog(...(args as [])),
}));

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    uid: VIDEO_ID,
    readyToStream: true,
    status: { state: "ready" },
    ...overrides,
  });
}

/** 実装と同じ方式で署名ヘッダを作る */
function sign(rawBody: string, secret: string, ts = "1750000000") {
  const v1 = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  return `ts=${ts},v1=${v1}`;
}

async function call(rawBody: string, signature: string | null) {
  const headers: Record<string, string> = {};
  if (signature) headers["webhook-signature"] = signature;

  const { POST } = await import("./route");
  return POST(
    new NextRequest("https://example.com/api/webhooks/cloudflare-stream", {
      method: "POST",
      body: rawBody,
      headers,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  dbSecret = SECRET;
  // NODE_ENV は型上 readonly なので vi.stubEnv 経由で差し替える。
  // 実装は本番判定でシークレット未設定を fail closed にするため、本番として動かす。
  vi.stubEnv("NODE_ENV", "production");
});

describe("Cloudflare Stream Webhook の署名検証", () => {
  it("正しい署名なら動画ステータスを更新する", async () => {
    const raw = body();
    const res = await call(raw, sign(raw, SECRET));

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  it("別のシークレットで署名されたリクエストを拒否する", async () => {
    const raw = body();
    const res = await call(raw, sign(raw, OTHER_SECRET));

    expect(res.status).toBe(401);
    // 更新まで進むと、外部から任意の動画のステータスを操作できてしまう
    expect(update).not.toHaveBeenCalled();
  });

  it("署名後に本文が改ざんされたリクエストを拒否する", async () => {
    const raw = body();
    const signature = sign(raw, SECRET);
    const tampered = raw.replace(VIDEO_ID, "someone_elses_video");

    const res = await call(tampered, signature);

    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("タイムスタンプを差し替えたリクエストを拒否する", async () => {
    // ts は HMAC の入力に含まれるため、付け替えると署名が一致しない
    const raw = body();
    const signature = sign(raw, SECRET).replace("ts=1750000000", "ts=1760000000");

    const res = await call(raw, signature);

    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("Webhook-Signature ヘッダが無いリクエストを拒否する", async () => {
    const res = await call(body(), null);

    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("v1 を欠いた署名ヘッダを拒否する", async () => {
    const res = await call(body(), "ts=1750000000");

    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("本番環境でシークレット未設定なら受信を拒否する", async () => {
    // 未設定で検証をスキップすると誰でも本文を偽装できるため fail closed。
    dbSecret = null;
    delete process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;

    const raw = body();
    const res = await call(raw, sign(raw, SECRET));

    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();

    // ステータスだけでは署名不一致による401と区別できないため、
    // 未設定を理由に拒否していることまで確認する。
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("未設定");
  });

  it("環境変数のシークレットにフォールバックする", async () => {
    dbSecret = null;
    process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = SECRET;

    const raw = body();
    const res = await call(raw, sign(raw, SECRET));

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();

    delete process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  });
});

describe("ペイロードの検証", () => {
  it("不正なJSONを拒否する", async () => {
    const raw = "{ this is not json";
    const res = await call(raw, sign(raw, SECRET));

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("uid が無いペイロードを拒否する", async () => {
    const raw = JSON.stringify({ readyToStream: true });
    const res = await call(raw, sign(raw, SECRET));

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

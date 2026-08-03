import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * APIキーの暗号化ユーティリティの検証。
 *
 * ここが壊れると、保存済みのStripe/LINE/AI/Cloudflareの認証情報が
 * 一斉に復号できなくなる（実際、ENCRYPTION_KEY を変更した際に
 * 既存レコードを作り直す必要が生じている）。
 */

const VALID_KEY = "a".repeat(64); // 32バイト = 64文字の16進数

async function freshImport() {
  // getKey() は呼び出しごとに process.env を読むが、
  // モジュールキャッシュの影響を避けるため毎回読み直す。
  return import("./crypto");
}

describe("encrypt / decrypt", () => {
  const original = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = original;
  });

  it("暗号化した値を復号すると元に戻る", async () => {
    const { encrypt, decrypt } = await freshImport();
    const plain = "sk_test_abcdefghijklmnop";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("日本語や記号を含む値も往復できる", async () => {
    const { encrypt, decrypt } = await freshImport();
    const plain = "テスト用キー:+/=@#$%";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("同じ平文でも毎回異なる暗号文になる（IVがランダム）", async () => {
    const { encrypt } = await freshImport();
    expect(encrypt("same-value")).not.toBe(encrypt("same-value"));
  });

  it("保存形式は iv:authTag:ciphertext の16進数3要素", async () => {
    const { encrypt } = await freshImport();
    expect(encrypt("x")).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("改ざんされた暗号文は復号に失敗する（GCMの認証タグ）", async () => {
    const { encrypt, decrypt } = await freshImport();
    const enc = encrypt("secret");
    const [iv, tag, ct] = enc.split(":");
    // 本文を1文字だけ書き換える
    const flipped = ct[0] === "0" ? "1" + ct.slice(1) : "0" + ct.slice(1);
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it("別の鍵で暗号化された値は復号できない", async () => {
    const { encrypt } = await freshImport();
    const enc = encrypt("secret");

    process.env.ENCRYPTION_KEY = "b".repeat(64);
    const { decrypt } = await freshImport();
    expect(() => decrypt(enc)).toThrow();
  });

  it("ENCRYPTION_KEY 未設定なら明示的に失敗する", async () => {
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = await freshImport();
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
  });

  it("鍵の長さが32バイトでなければ失敗する", async () => {
    process.env.ENCRYPTION_KEY = "abcd";
    const { encrypt } = await freshImport();
    expect(() => encrypt("x")).toThrow(/32バイト/);
  });
});

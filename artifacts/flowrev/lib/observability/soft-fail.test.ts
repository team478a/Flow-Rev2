import { describe, it, expect, vi, afterEach } from "vitest";
import { softFail } from "./soft-fail";

/**
 * 握りつぶしの検証。
 *
 * ここで守りたいのは2つで、どちらか片方だけでは意味がない。
 *  - フォールバック値を返すこと（画面を落とさない）
 *  - 理由をログに残すこと（データ無しと取得失敗を区別できる）
 *
 * 後者が欠けると、`.catch(() => [])` と同じで原因の切り分けができなくなる。
 */

afterEach(() => vi.restoreAllMocks());

describe("softFail", () => {
  it("フォールバック値を返す", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await Promise.reject(new Error("boom")).catch(
      softFail("コース一覧", [] as string[]),
    );

    expect(result).toEqual([]);
    expect(err).toHaveBeenCalled();
  });

  it("ラベルと理由をログに残す", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await Promise.reject(new Error("relation does not exist")).catch(
      softFail("コース一覧", null),
    );

    const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("コース一覧");
    expect(logged).toContain("relation does not exist");
  });

  it("Error でない値でも理由を残す", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await Promise.reject("文字列で投げられた").catch(softFail("何か", null));

    expect(String(err.mock.calls[0]?.[0])).toContain("文字列で投げられた");
  });
});

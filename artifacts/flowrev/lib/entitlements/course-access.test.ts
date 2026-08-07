import { describe, it, expect } from "vitest";
import { filterAccessibleCourses, canAccessCourse } from "./course-access";

/**
 * コース閲覧権限の検証。
 *
 * 誤りの向きで意味が正反対になる。
 *   - 緩すぎる … 購入していない商品のコースが見える（売上を失う）
 *   - 厳しすぎる … 購入した顧客が自分のコースを見られない（返金・問い合わせ）
 *
 * 前者は正常系のテストでは絶対に検出できない。購入済みの顧客で試すと
 * 「見える」のが正しいため、全部見えていても気づけない。
 */

const FREE = { id: "free", productId: null };
const COURSE_A = { id: "a", productId: "product-a" };
const COURSE_B = { id: "b", productId: "product-b" };

describe("コースの閲覧可否", () => {
  it("商品が紐付いていないコースは全員が見られる", () => {
    // 販売対象ではないコース。購入が無くても見られる必要がある。
    expect(canAccessCourse(FREE, new Set())).toBe(true);
  });

  it("購入した商品のコースは見られる", () => {
    expect(canAccessCourse(COURSE_A, new Set(["product-a"]))).toBe(true);
  });

  it("購入していない商品のコースは見られない", () => {
    expect(canAccessCourse(COURSE_A, new Set())).toBe(false);
  });

  it("別の商品を買っても他の商品のコースは見られない", () => {
    // 以前の実装は「このクライアントで何か1件でも購入があるか」だったため、
    // 商品Aを買うと商品Bのコースまで見えていた。
    expect(canAccessCourse(COURSE_B, new Set(["product-a"]))).toBe(false);
  });
});

describe("一覧の絞り込み", () => {
  it("購入済みと無料のコースだけを残す", () => {
    const result = filterAccessibleCourses(
      [FREE, COURSE_A, COURSE_B],
      ["product-a"],
    );

    expect(result.map((c) => c.id)).toEqual(["free", "a"]);
  });

  it("購入が無ければ無料コースだけになる", () => {
    const result = filterAccessibleCourses([FREE, COURSE_A, COURSE_B], []);

    expect(result.map((c) => c.id)).toEqual(["free"]);
  });

  it("元の配列を書き換えない", () => {
    const courses = [FREE, COURSE_A];

    filterAccessibleCourses(courses, []);

    expect(courses).toHaveLength(2);
  });
});

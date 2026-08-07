/**
 * 顧客がどのコースを見られるかを決める規則。
 *
 * 規則は2つだけ。
 *   - `productId` が無いコース  … 販売対象ではないので、そのクライアントの顧客全員が見られる
 *   - `productId` があるコース  … その商品を購入（paid）した顧客だけが見られる
 *
 * コース詳細（`/my/courses/[id]`）は以前からこの判定をしていたのに、
 * 一覧（`/my`）は「そのクライアントで何か1件でも購入があるか」という
 * 真偽値1つで全コースの表示を決めていた。つまり**一覧と詳細で判定が食い違い**、
 * 一覧に出ているコースを開くと購入案内が出る、という状態だった。
 * さらに商品Aを買うと商品Bのコースまで一覧に並んでいた。
 *
 * 判定を一箇所に集め、両方の画面から使う。
 */

export interface CourseAccessInput {
  id: string;
  productId: string | null;
}

/**
 * 購入済み商品の集合をもとに、閲覧できるコースだけを残す。
 * 呼び出し側で毎回 filter を書くと片方の画面だけ直し忘れるため、ここに置く。
 */
export function filterAccessibleCourses<T extends CourseAccessInput>(
  courses: T[],
  purchasedProductIds: Iterable<string>,
): T[] {
  const purchased = new Set(purchasedProductIds);
  return courses.filter((c) => canAccessCourse(c, purchased));
}

/** 単一コースの判定。詳細ページと一覧で同じ規則を使うためのもの。 */
export function canAccessCourse(
  course: CourseAccessInput,
  purchasedProductIds: ReadonlySet<string>,
): boolean {
  if (!course.productId) return true;
  return purchasedProductIds.has(course.productId);
}

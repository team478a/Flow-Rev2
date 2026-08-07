"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/features/auth/session";
import {
  createLandingPage,
  updateLandingPage,
  deleteLandingPage,
  getLandingPage,
  listLandingPages,
} from "@/lib/repositories/landing-pages";
import { lpSchema } from "@/features/lp/schema";
import { sanitizeLpHtml } from "@/lib/sanitize";

export interface LpActionState {
  error: string | null;
  success?: boolean;
}

/**
 * LP作成サーバーアクション。client_owner のみ実行可能。
 * client_id / white_label_id はセッションから取得し、フォーム入力に依存しない。
 */
export async function createLpAction(
  _prev: LpActionState,
  formData: FormData,
): Promise<LpActionState> {
  const session = await getSessionProfile();
  if (session?.role !== "client_owner") {
    return { error: "この操作を行う権限がありません。" };
  }
  if (!session.clientId || !session.whiteLabelId) {
    return { error: "クライアント情報が取得できませんでした。" };
  }

  const rawProductId = String(formData.get("productId") ?? "").trim();
  const parsed = lpSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    productId: rawProductId && rawProductId !== "none" ? rawProductId : undefined,
    htmlContent: formData.get("htmlContent") || undefined,
    status: formData.get("status"),
    designStyleName: formData.get("designStyleName") || undefined,
    colorPrimary: formData.get("colorPrimary") || undefined,
    colorBg: formData.get("colorBg") || undefined,
    colorAccent: formData.get("colorAccent") || undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }

  // 保存時にもサニタイズする（多層防御）。公開ページ側でも sanitizeLpHtml を適用
  // 済みのため新たに失われる内容はないが、保存直後から一貫した内容にできる
  // （docs/audit/05_SECURITY_FINDINGS.md C-2 の多層防御。デザインCSSは別列に
  // 分離済みのため、ここでのサニタイズがAIデザインシステムを壊すことはない）。
  const sanitizedHtmlContent =
    parsed.data.htmlContent !== undefined
      ? sanitizeLpHtml(parsed.data.htmlContent)
      : undefined;

  try {
    const lp = await createLandingPage({
      title: parsed.data.title,
      slug: parsed.data.slug,
      productId: parsed.data.productId || undefined,
      htmlContent: sanitizedHtmlContent,
      status: parsed.data.status,
      clientId: session.clientId,
      whiteLabelId: session.whiteLabelId,
      designStyleName: parsed.data.designStyleName || undefined,
      designColorPrimary: parsed.data.colorPrimary || undefined,
      designColorBg: parsed.data.colorBg || undefined,
      designColorAccent: parsed.data.colorAccent || undefined,
    });
    revalidatePath("/lp");
    redirect(`/lp/${lp.id}`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
    return { error: e instanceof Error ? e.message : "作成に失敗しました。" };
  }
}

/**
 * LP更新サーバーアクション。client_owner のみ実行可能。
 * RLS USING 句で自テナント以外への更新は DB レベルで拒否される。
 */
export async function updateLpAction(
  id: string,
  _prev: LpActionState,
  formData: FormData,
): Promise<LpActionState> {
  const session = await getSessionProfile();
  if (session?.role !== "client_owner") {
    return { error: "この操作を行う権限がありません。" };
  }

  const rawProductId = String(formData.get("productId") ?? "").trim();
  const parsed = lpSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    productId: rawProductId && rawProductId !== "none" ? rawProductId : undefined,
    htmlContent: formData.get("htmlContent") || undefined,
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }

  const lineAddUrl = ((formData.get("lineAddUrl") as string | null) ?? "").trim() || null;

  // 保存時にもサニタイズする（多層防御）。詳細は createLpAction のコメント参照。
  const sanitizedHtmlContent =
    parsed.data.htmlContent !== undefined
      ? sanitizeLpHtml(parsed.data.htmlContent)
      : undefined;

  try {
    await updateLandingPage(id, {
      title: parsed.data.title,
      slug: parsed.data.slug,
      productId: parsed.data.productId ?? null,
      htmlContent: sanitizedHtmlContent,
      lineAddUrl,
      status: parsed.data.status,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "更新に失敗しました。" };
  }

  revalidatePath("/lp");
  revalidatePath(`/lp/${id}`);
  return { error: null, success: true };
}

/**
 * LP削除サーバーアクション。client_owner のみ実行可能。
 */
export async function deleteLpAction(id: string): Promise<LpActionState> {
  const session = await getSessionProfile();
  if (session?.role !== "client_owner") {
    return { error: "この操作を行う権限がありません。" };
  }

  try {
    await deleteLandingPage(id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "削除に失敗しました。" };
  }

  revalidatePath("/lp");
  redirect("/lp");
}

/**
 * LPを複製する。client_owner のみ実行可能。
 *
 * 媒体別・商品別に似たLPを何本も作る運用が前提なので、
 * 毎回ゼロから作り直すのは現実的でない。
 *
 * 複製は必ず**下書き**で作る。公開状態のまま複製すると、
 * 中身を直す前のページが `/p/<新しいslug>` で世に出てしまう。
 *
 * PV・登録数は引き継がない。複製先の成績として意味を持たないうえ、
 * 引き継ぐとCVRが実態とずれる。
 */
export async function duplicateLpAction(
  lpId: string,
): Promise<{ error: string | null; newId?: string }> {
  const session = await getSessionProfile();
  if (session?.role !== "client_owner") {
    return { error: "この操作を行う権限がありません。" };
  }
  if (!session.clientId || !session.whiteLabelId) {
    return { error: "クライアント情報が取得できませんでした。" };
  }

  // RLS適用のクライアントで引くため、他テナントのIDでは取得できない。
  const source = await getLandingPage(lpId);
  if (!source) {
    return { error: "複製元のLPが見つかりませんでした。" };
  }

  const slug = await findAvailableSlug(source.slug);

  try {
    const created = await createLandingPage({
      title: `${source.title}（複製）`,
      slug,
      htmlContent: source.htmlContent ?? undefined,
      productId: source.productId ?? undefined,
      status: "draft",
      clientId: session.clientId,
      whiteLabelId: session.whiteLabelId,
      designStyleName: source.designStyleName ?? undefined,
      designColorPrimary: source.designColorPrimary ?? undefined,
      designColorBg: source.designColorBg ?? undefined,
      designColorAccent: source.designColorAccent ?? undefined,
    });
    revalidatePath("/lp");
    return { error: null, newId: created.id };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "複製に失敗しました。",
    };
  }
}

/**
 * 使われていないスラッグを探す。
 *
 * `UNIQUE(client_id, slug)` があるため、重複すると保存が失敗する。
 * 「複製を押したらエラーが出た」で終わらせないよう、連番で空きを探す。
 */
async function findAvailableSlug(baseSlug: string): Promise<string> {
  const existing = await listLandingPages().catch(() => []);
  const taken = new Set(existing.map((lp) => lp.slug));

  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${baseSlug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 50本まで埋まっている場合は時刻を混ぜる（衝突はまず起きない）。
  return `${baseSlug}-${Date.now().toString(36)}`;
}

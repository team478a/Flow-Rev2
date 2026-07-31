import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface LandingPageRow {
  id: string;
  title: string;
  slug: string;
  htmlContent: string | null;
  productId: string | null;
  lineAddUrl: string | null;
  status: string;
  views: number;
  conversions: number;
  aiGenerated: boolean;
  clientId: string;
  whiteLabelId: string;
  designStyleName: string | null;
  designColorPrimary: string | null;
  designColorBg: string | null;
  designColorAccent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLandingPageInput {
  title: string;
  slug: string;
  htmlContent?: string;
  productId?: string;
  status: string;
  clientId: string;
  whiteLabelId: string;
  designStyleName?: string;
  designColorPrimary?: string;
  designColorBg?: string;
  designColorAccent?: string;
}

export interface UpdateLandingPageInput {
  title?: string;
  slug?: string;
  htmlContent?: string;
  productId?: string | null;
  lineAddUrl?: string | null;
  status?: string;
}

function mapRow(r: Record<string, unknown>): LandingPageRow {
  return {
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string,
    htmlContent: (r.html_content as string) ?? null,
    productId: (r.product_id as string) ?? null,
    lineAddUrl: (r.line_add_url as string) ?? null,
    status: r.status as string,
    views: (r.views as number) ?? 0,
    conversions: (r.conversions as number) ?? 0,
    aiGenerated: (r.ai_generated as boolean) ?? false,
    clientId: r.client_id as string,
    whiteLabelId: r.white_label_id as string,
    designStyleName: (r.design_style_name as string) ?? null,
    designColorPrimary: (r.design_color_primary as string) ?? null,
    designColorBg: (r.design_color_bg as string) ?? null,
    designColorAccent: (r.design_color_accent as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

const SELECT_COLS =
  "id, title, slug, html_content, product_id, line_add_url, status, views, conversions, ai_generated, client_id, white_label_id, design_style_name, design_color_primary, design_color_bg, design_color_accent, created_at, updated_at";

/** LP一覧を取得する（新しい順）。RLS で自テナントのみ。 */
export async function listLandingPages(): Promise<LandingPageRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("landing_pages")
    .select(SELECT_COLS)
    .order("created_at", { ascending: false });

  if (error) throwSafe("LP一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** LP を1件取得する（セッションクライアント、RLS 適用）。 */
export async function getLandingPage(id: string): Promise<LandingPageRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("landing_pages")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) throwSafe("LPの取得に失敗しました", error);
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

/** 公開ページ表示に必要な最小限のフィールド。 */
export interface PublicLandingPage {
  id: string;
  title: string;
  slug: string;
  htmlContent: string | null;
  designStyleName: string | null;
  designColorPrimary: string | null;
  designColorBg: string | null;
  designColorAccent: string | null;
}

/**
 * スラッグから公開LPを取得する（認証不要の公開ページ用）。
 * 本体 landing_pages には anon ポリシーを付けず、公開列のみを返すビュー
 * public_landing_pages（status='published' に限定済み）を参照する。
 * これにより client_id / views / conversions 等の内部メタデータは anon に露出しない。
 */
export async function getPublishedLandingPageBySlug(
  slug: string,
): Promise<PublicLandingPage | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("public_landing_pages")
    .select(
      "id, title, slug, html_content, design_style_name, design_color_primary, design_color_bg, design_color_accent",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throwSafe("LPの取得に失敗しました", error);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string,
    htmlContent: (r.html_content as string) ?? null,
    designStyleName: (r.design_style_name as string) ?? null,
    designColorPrimary: (r.design_color_primary as string) ?? null,
    designColorBg: (r.design_color_bg as string) ?? null,
    designColorAccent: (r.design_color_accent as string) ?? null,
  };
}

/** LPを作成する。client_id / white_label_id はセッションから渡す。 */
export async function createLandingPage(
  input: CreateLandingPageInput,
): Promise<LandingPageRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("landing_pages")
    .insert({
      title: input.title,
      slug: input.slug,
      html_content: input.htmlContent ?? null,
      product_id: input.productId ?? null,
      status: input.status,
      client_id: input.clientId,
      white_label_id: input.whiteLabelId,
      design_style_name: input.designStyleName ?? null,
      design_color_primary: input.designColorPrimary ?? null,
      design_color_bg: input.designColorBg ?? null,
      design_color_accent: input.designColorAccent ?? null,
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data)
    throwSafe("LPの作成に失敗しました", error);
  return mapRow(data as Record<string, unknown>);
}

/** LPを更新する。RLS USING 句で自テナント以外は更新不可。 */
export async function updateLandingPage(
  id: string,
  input: UpdateLandingPageInput,
): Promise<LandingPageRow> {
  const supabase = createClient();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.htmlContent !== undefined) patch.html_content = input.htmlContent;
  if ("productId" in input) patch.product_id = input.productId ?? null;
  if ("lineAddUrl" in input) patch.line_add_url = input.lineAddUrl ?? null;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase
    .from("landing_pages")
    .update(patch)
    .eq("id", id)
    .select(SELECT_COLS)
    .single();

  if (error || !data)
    throwSafe("LPの更新に失敗しました", error);
  return mapRow(data as Record<string, unknown>);
}

/** LPを削除する。RLS USING 句で自テナント以外は削除不可。 */
export async function deleteLandingPage(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("landing_pages").delete().eq("id", id);
  if (error) throwSafe("LPの削除に失敗しました", error);
}

/**
 * 商品 ID に紐づく公開済み LP のスラッグを返す（顧客向け購入ページリンク用）。
 * RLS 非適用の admin client を使用。見つからない場合は null。
 */
export async function getPublishedLpByProductId(
  productId: string,
): Promise<{ slug: string; title: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("landing_pages")
    .select("slug, title")
    .eq("product_id", productId)
    .eq("status", "published")
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return { slug: r.slug as string, title: r.title as string };
}

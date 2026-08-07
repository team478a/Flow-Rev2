import { notFound } from "next/navigation";
import { getPublishedLandingPageBySlug } from "@/lib/repositories/landing-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { LpRenderer } from "@/features/lp/components/lp-renderer";

interface Props {
  params: { slug: string };
}

export const dynamic = "force-dynamic";

interface ProductInfo {
  name: string;
  price: number;
  priceType: string;
}

interface LpMeta {
  product: ProductInfo | null;
  lineAddUrl: string | null;
}

/**
 * 閲覧数をインクリメント（fire-and-forget）。
 *
 * 以前は SELECT してから +1 を UPDATE していたため、同時アクセスで
 * カウントが落ちていた（lost update）。PVは登録数の分母なので、
 * 落ちるとCVRが実際より高く出て、出稿の判断を誤らせる。
 * 0023 で定義した関数でDB側の1文として加算する。
 */
async function incrementViews(lpId: string) {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("increment_lp_views", { lp_id: lpId });
    if (error) {
      // 未適用環境などで関数が無い場合。ページ表示は続ける。
      console.warn(`[LP] PV加算に失敗 (lp ${lpId}): ${error.message}`);
    }
  } catch {
    // 閲覧カウント失敗はページ表示に影響させない
  }
}

/** LP に紐付く商品情報と LINE URL を取得する */
async function getLpMeta(lpId: string): Promise<LpMeta> {
  try {
    const admin = createAdminClient();
    const { data: lpRow } = await admin
      .from("landing_pages")
      .select("product_id, line_add_url")
      .eq("id", lpId)
      .maybeSingle();

    const row = lpRow as Record<string, unknown> | null;
    const lineAddUrl = (row?.line_add_url as string) ?? null;
    const productId = (row?.product_id as string) ?? null;

    if (!productId) return { product: null, lineAddUrl };

    const { data: productRow } = await admin
      .from("products")
      .select("name, price, price_type")
      .eq("id", productId)
      .maybeSingle();

    if (!productRow) return { product: null, lineAddUrl };
    const p = productRow as Record<string, unknown>;
    const price = (p.price as number) ?? 0;
    const priceType = (p.price_type as string) ?? "free";

    if (price <= 0 || priceType === "free") return { product: null, lineAddUrl };

    return {
      product: { name: (p.name as string) ?? "", price, priceType },
      lineAddUrl,
    };
  } catch {
    return { product: null, lineAddUrl: null };
  }
}

export default async function PublicLpPage({ params }: Props) {
  let lp: Awaited<ReturnType<typeof getPublishedLandingPageBySlug>> = null;

  try {
    lp = await getPublishedLandingPageBySlug(params.slug);
  } catch {
    lp = null;
  }

  if (!lp) notFound();

  const [{ product, lineAddUrl }] = await Promise.all([
    getLpMeta(lp.id),
    incrementViews(lp.id),
  ]);

  return (
    <LpRenderer
      lpId={lp.id}
      title={lp.title}
      htmlContent={lp.htmlContent ?? null}
      design={lp}
      product={product}
      lineAddUrl={lineAddUrl}
    />
  );
}

import { notFound } from "next/navigation";
import {
  getPublishedLandingPageBySlug,
  type PublicLandingPage,
} from "@/lib/repositories/landing-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeLpHtml } from "@/lib/sanitize";
import { generateLpCss, isValidHexColor } from "@/lib/ai/lp-design-system";
import { LpContactForm } from "@/features/lp/components/lp-contact-form";

/**
 * LP保存時に別列として保存されたデザイン設定からCSSを組み立てる。
 * これはアプリ自身が生成する信頼できる文字列であり、AI/ユーザー制御下の
 * html_content とは別に（サニタイザーを経由せず）配信する
 * （docs/audit/05_SECURITY_FINDINGS.md L-2 の修正）。
 * 列が未設定（旧データ・自由編集で作成されたLP）の場合は何も返さない。
 */
function buildTrustedLpCss(lp: PublicLandingPage): string | null {
  const { designStyleName, designColorPrimary, designColorBg, designColorAccent } = lp;
  if (!designStyleName || !designColorPrimary || !designColorBg || !designColorAccent) {
    return null;
  }
  if (![designColorPrimary, designColorBg, designColorAccent].every(isValidHexColor)) {
    return null;
  }
  return generateLpCss(
    { primary: designColorPrimary, bg: designColorBg, accent: designColorAccent },
    designStyleName,
  );
}

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

/** 閲覧数をインクリメント（fire-and-forget） */
async function incrementViews(lpId: string) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("landing_pages")
      .select("views")
      .eq("id", lpId)
      .maybeSingle();
    const current = ((data as Record<string, unknown> | null)?.views as number) ?? 0;
    await admin
      .from("landing_pages")
      .update({ views: current + 1 })
      .eq("id", lpId);
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

  const isPaid = !!product;
  const trustedCss = buildTrustedLpCss(lp);

  return (
    <div className="min-h-screen bg-white">
      {/* AIデザインシステムのCSS。html_content（サニタイズ対象）とは別に保存された
          design_* 列から生成する、アプリ自身が所有する信頼できるスタイルシート。
          CSSテキストなのでHTMLインジェクションの懸念はなく dangerouslySetInnerHTML は不要。 */}
      {trustedCss && <style>{trustedCss}</style>}
      <div className="max-w-3xl mx-auto px-4 py-12">

        {/* LPコンテンツ（HTML） */}
        {lp.htmlContent ? (
          <div
            className="prose prose-lg max-w-none mb-16"
            dangerouslySetInnerHTML={{ __html: sanitizeLpHtml(lp.htmlContent) }}
          />
        ) : (
          <div className="text-center py-20 text-gray-400 mb-16">
            <p className="text-lg font-semibold text-gray-700">{lp.title}</p>
            <p className="text-sm mt-2">コンテンツが設定されていません</p>
          </div>
        )}

        {/* LINE 友だち追加ボタン */}
        {lineAddUrl && (
          <div className="mb-8 flex justify-center">
            <a
              href={lineAddUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 rounded-full bg-[#06C755] px-8 py-3.5 text-white font-bold text-base shadow-md hover:bg-[#05b04c] transition-colors"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
                <path d="M12 2C6.48 2 2 5.92 2 10.72c0 3.21 1.77 6.04 4.47 7.74-.09.52-.56 2.93-.59 3.1 0 0-.01.11.06.16.07.04.15.02.15.02.19-.03 2.2-1.45 3.09-2.04.71.1 1.44.16 2.2.16C17.52 19.86 22 15.93 22 10.72S17.52 2 12 2z"/>
              </svg>
              LINE を友だち追加する
            </a>
          </div>
        )}

        {/* 価格カード（有料商品の場合のみ） */}
        {isPaid && product && (
          <div className="mb-6 rounded-2xl border-2 border-primary/30 bg-primary/5 px-6 py-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary/70 mb-1">
              {product.name}
            </p>
            <p className="text-4xl font-bold text-primary">
              ¥{product.price.toLocaleString()}
              <span className="text-base font-normal text-muted-foreground ml-1">（税込）</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              下のフォームにご入力いただくと、Stripe の決済画面に移動します。
            </p>
          </div>
        )}

        {/* お問い合わせ / 購入フォーム */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-8 shadow-sm">
          <h2 className="text-xl font-bold text-center mb-2">
            {isPaid ? "ご購入手続き" : "お問い合わせ・ご登録"}
          </h2>
          <p className="text-sm text-gray-500 text-center mb-6">
            {isPaid
              ? "以下にご入力のうえ「今すぐ購入する」をクリックしてください。"
              : "以下のフォームにご入力のうえ送信してください。"}
          </p>
          <LpContactForm lpId={lp.id} isPaid={isPaid} />
        </div>
      </div>
    </div>
  );
}

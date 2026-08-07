import { sanitizeLpHtml } from "@/lib/sanitize";
import { generateLpCss, isValidHexColor } from "@/lib/ai/lp-design-system";
import { LpContactForm } from "@/features/lp/components/lp-contact-form";

export interface LpDesign {
  designStyleName: string | null;
  designColorPrimary: string | null;
  designColorBg: string | null;
  designColorAccent: string | null;
}

export interface LpProductInfo {
  name: string;
  price: number;
}

/**
 * LP保存時に別列として保存されたデザイン設定からCSSを組み立てる。
 * これはアプリ自身が生成する信頼できる文字列であり、AI/ユーザー制御下の
 * html_content とは別に（サニタイザーを経由せず）配信する
 * （docs/audit/05_SECURITY_FINDINGS.md L-2 の修正）。
 * 列が未設定（旧データ・自由編集で作成されたLP）の場合は何も返さない。
 */
export function buildTrustedLpCss(lp: LpDesign): string | null {
  const { designStyleName, designColorPrimary, designColorBg, designColorAccent } =
    lp;
  if (
    !designStyleName ||
    !designColorPrimary ||
    !designColorBg ||
    !designColorAccent
  ) {
    return null;
  }
  if (
    ![designColorPrimary, designColorBg, designColorAccent].every(isValidHexColor)
  ) {
    return null;
  }
  return generateLpCss(
    {
      primary: designColorPrimary,
      bg: designColorBg,
      accent: designColorAccent,
    },
    designStyleName,
  );
}

interface Props {
  lpId: string;
  title: string;
  htmlContent: string | null;
  design: LpDesign;
  product: LpProductInfo | null;
  lineAddUrl: string | null;
  /**
   * フォームから実際に登録できるか。
   *
   * プレビューでは false。下書きのLPは `/api/p/register` が公開状態でないと
   * 受け付けないため送信しても失敗するが、それ以前に**確認のつもりの操作で
   * 本物の顧客が作られる**のを避けたい。
   */
  interactive?: boolean;
}

/**
 * 公開ページとプレビューで共通のLP描画。
 *
 * 片方だけ直すと「プレビューでは正しいのに公開すると崩れる」という、
 * 確認の意味が無くなる状態になるため、1つの実装を両方から使う。
 */
export function LpRenderer({
  lpId,
  title,
  htmlContent,
  design,
  product,
  lineAddUrl,
  interactive = true,
}: Props) {
  const trustedCss = buildTrustedLpCss(design);
  const isPaid = !!product;

  return (
    <div className="min-h-screen bg-white">
      {/* CSSテキストなのでHTMLインジェクションの懸念はなく dangerouslySetInnerHTML は不要。 */}
      {trustedCss && <style>{trustedCss}</style>}
      <div className="max-w-3xl mx-auto px-4 py-12">
        {htmlContent ? (
          <div
            className="prose prose-lg max-w-none mb-16"
            dangerouslySetInnerHTML={{ __html: sanitizeLpHtml(htmlContent) }}
          />
        ) : (
          <div className="text-center py-20 text-gray-400 mb-16">
            <p className="text-lg font-semibold text-gray-700">{title}</p>
            <p className="text-sm mt-2">コンテンツが設定されていません</p>
          </div>
        )}

        {lineAddUrl && (
          <div className="mb-8 flex justify-center">
            <a
              href={lineAddUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 rounded-full bg-[#06C755] px-8 py-3.5 text-white font-bold text-base shadow-md hover:bg-[#05b04c] transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 fill-current"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 5.92 2 10.72c0 3.21 1.77 6.04 4.47 7.74-.09.52-.56 2.93-.59 3.1 0 0-.01.11.06.16.07.04.15.02.15.02.19-.03 2.2-1.45 3.09-2.04.71.1 1.44.16 2.2.16C17.52 19.86 22 15.93 22 10.72S17.52 2 12 2z" />
              </svg>
              LINE を友だち追加する
            </a>
          </div>
        )}

        {isPaid && product && (
          <div className="mb-6 rounded-2xl border-2 border-primary/30 bg-primary/5 px-6 py-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary/70 mb-1">
              {product.name}
            </p>
            <p className="text-4xl font-bold text-primary">
              ¥{product.price.toLocaleString()}
              <span className="text-base font-normal text-muted-foreground ml-1">
                （税込）
              </span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              下のフォームにご入力いただくと、Stripe の決済画面に移動します。
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-8 shadow-sm">
          <h2 className="text-xl font-bold text-center mb-2">
            {isPaid ? "ご購入手続き" : "お問い合わせ・ご登録"}
          </h2>
          <p className="text-sm text-gray-500 text-center mb-6">
            {isPaid
              ? "以下にご入力のうえ「今すぐ購入する」をクリックしてください。"
              : "以下のフォームにご入力のうえ送信してください。"}
          </p>
          {interactive ? (
            <LpContactForm lpId={lpId} isPaid={isPaid} />
          ) : (
            <p className="rounded-md border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
              プレビューでは送信できません。公開後に実際の登録が可能になります。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

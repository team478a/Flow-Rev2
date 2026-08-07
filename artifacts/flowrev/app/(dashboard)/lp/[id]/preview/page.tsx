import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireClientOwner } from "@/features/wl/guard";
import { getLandingPage } from "@/lib/repositories/landing-pages";
import { getProduct } from "@/lib/repositories/products";
import { LpRenderer } from "@/features/lp/components/lp-renderer";
import { softFail } from "@/lib/observability/soft-fail";

export const dynamic = "force-dynamic";

interface Props {
  params: { id: string };
}

/**
 * 下書きLPのプレビュー。
 *
 * 公開ページ（`/p/<slug>`）は `status = 'published'` のLPしか表示しないため、
 * これまで**公開するまで実物を確認する手段が無かった**。
 * 公開してから直す運用になり、その間は未完成のページが世に出てしまう。
 *
 * 描画は公開ページと同じ `LpRenderer` を使う。別実装にすると
 * 「プレビューでは正しいのに公開すると崩れる」となり、確認の意味が無くなる。
 *
 * `getLandingPage` はセッションクライアント（RLS適用）で引くため、
 * 他テナントのLPのIDを入れても取得できない。
 */
export default async function LpPreviewPage({ params }: Props) {
  await requireClientOwner();

  const lp = await getLandingPage(params.id).catch(
    softFail("LPプレビューの取得", null),
  );
  if (!lp) notFound();

  const product = lp.productId
    ? await getProduct(lp.productId).catch(softFail("商品の取得", null))
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/lp/${lp.id}`}
            className="inline-flex items-center text-sm text-amber-900 hover:underline"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            編集に戻る
          </Link>
          <span className="text-sm text-amber-900">
            プレビュー表示です。実際の公開ページではありません。
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-900">
          {lp.status === "published" ? "公開中" : "下書き"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <LpRenderer
          lpId={lp.id}
          title={lp.title}
          htmlContent={lp.htmlContent ?? null}
          design={lp}
          product={
            product && product.price > 0
              ? { name: product.name, price: product.price }
              : null
          }
          lineAddUrl={lp.lineAddUrl ?? null}
          interactive={false}
        />
      </div>
    </div>
  );
}

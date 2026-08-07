import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Eye } from "lucide-react";
import {
  getLandingPage,
  getLpTrafficBreakdown,
} from "@/lib/repositories/landing-pages";
import { listProducts } from "@/lib/repositories/products";
import { LpForm } from "@/features/lp/components/lp-form";
import { updateLpAction, deleteLpAction, duplicateLpAction } from "@/features/lp/actions";
import { DeleteLpButton } from "@/features/lp/components/delete-lp-button";
import { LpTrafficBreakdown } from "@/features/lp/components/lp-traffic-breakdown";
import { CopyLpUrlButton } from "@/features/lp/components/copy-lp-url-button";
import { DuplicateLpButton } from "@/features/lp/components/duplicate-lp-button";
import { softFail } from "@/lib/observability/soft-fail";

export const dynamic = "force-dynamic";

interface Props {
  params: { id: string };
}

export default async function EditLpPage({ params }: Props) {
  let lp: Awaited<ReturnType<typeof getLandingPage>> = null;
  let products: Awaited<ReturnType<typeof listProducts>> = [];

  try {
    [lp, products] = await Promise.all([
      getLandingPage(params.id),
      listProducts(),
    ]);
  } catch {
    lp = null;
    products = [];
  }

  if (!lp) notFound();

  // 集計に失敗しても編集画面は開けるようにする。ただし黙って0件に見せない。
  const traffic = await getLpTrafficBreakdown(lp.id).catch(
    softFail("流入元の集計", { sources: [], total: 0, truncated: false }),
  );

  const boundUpdateAction = updateLpAction.bind(null, lp.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/lp"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          LP一覧に戻る
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">LPを編集</h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/lp/${lp.id}/preview`}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <Eye className="h-4 w-4" />
              プレビュー
            </Link>
            <DuplicateLpButton lpId={lp.id} duplicateAction={duplicateLpAction} />
            {lp.status === "published" && <CopyLpUrlButton path={`/p/${lp.slug}`} />}
            {lp.status === "published" && (
              <Link
                href={`/p/${lp.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
                公開ページを見る
              </Link>
            )}
            <DeleteLpButton
              lpId={lp.id}
              lpTitle={lp.title}
              deleteAction={deleteLpAction}
            />
          </div>
        </div>
      </div>

      <LpTrafficBreakdown
        sources={traffic.sources}
        total={traffic.total}
        truncated={traffic.truncated}
      />

      <LpForm
        action={boundUpdateAction}
        defaultValues={lp}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        submitLabel="保存する"
        successPath="/lp"
      />
    </div>
  );
}

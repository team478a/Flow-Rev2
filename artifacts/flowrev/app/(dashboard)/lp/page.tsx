import Link from "next/link";
import { Plus, FileText, TrendingUp, Eye, Users } from "lucide-react";
import { listLandingPages } from "@/lib/repositories/landing-pages";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireClientOwner } from "@/features/wl/guard";
import { getClientPlanFeatures } from "@/lib/features/client-features";
import { hasFeature } from "@/lib/features/plan-features";
import { FeatureDisabledMessage } from "@/features/dashboard/components/feature-gate";
import { CopyLpUrlButton } from "@/features/lp/components/copy-lp-url-button";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "公開中",
  archived: "アーカイブ",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  published: "default",
  archived: "outline",
};

function conversionRateClass(rate: number): string {
  if (rate >= 5) return "text-green-600 font-semibold";
  if (rate >= 1) return "text-amber-600";
  return "text-muted-foreground";
}

interface ConversionBarProps {
  views: number;
  conversions: number;
}

function ConversionBar({ views, conversions }: ConversionBarProps) {
  const rate = views > 0 ? (conversions / views) * 100 : 0;
  const pct = Math.min(rate, 100);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Eye className="h-3 w-3" />
          {views.toLocaleString()} PV
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-3 w-3" />
          {conversions.toLocaleString()} 登録
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={[
            "h-full rounded-full transition-all",
            rate >= 5
              ? "bg-green-500"
              : rate >= 1
                ? "bg-amber-400"
                : "bg-muted-foreground/30",
          ].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span
          className={`flex items-center gap-1 text-xs ${conversionRateClass(rate)}`}
        >
          <TrendingUp className="h-3 w-3" />
          CV率 {rate.toFixed(1)}%
        </span>
        {rate >= 5 && (
          <span className="text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
            好調
          </span>
        )}
      </div>
    </div>
  );
}

export default async function LpListPage() {
  const session = await requireClientOwner();
  if (session.clientId) {
    const features = await getClientPlanFeatures(session.clientId);
    if (!hasFeature(features, "lp_builder")) {
      return <FeatureDisabledMessage featureName="LP管理" />;
    }
  }

  let pages: Awaited<ReturnType<typeof listLandingPages>> = [];
  let fetchError: string | null = null;

  try {
    pages = await listLandingPages();
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "取得に失敗しました";
  }

  const totalViews = pages.reduce((s, p) => s + p.views, 0);
  const totalConversions = pages.reduce((s, p) => s + p.conversions, 0);
  const totalRate =
    totalViews > 0
      ? ((totalConversions / totalViews) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">LP管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ランディングページを管理します
          </p>
        </div>
        <Button asChild>
          <Link href="/lp/new">
            <Plus className="h-4 w-4 mr-2" />
            新規作成
          </Link>
        </Button>
      </div>

      {/* 集計サマリー */}
      {pages.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { label: "合計 PV", value: totalViews.toLocaleString() },
              { label: "合計登録数", value: totalConversions.toLocaleString() },
              { label: "平均 CV率", value: `${totalRate}%` },
            ] as { label: string; value: string }[]
          ).map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-card px-4 py-3 text-center"
            >
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-xl font-bold">{value}</p>
            </div>
          ))}
        </div>
      )}

      {fetchError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {fetchError}
        </p>
      )}

      {pages.length === 0 && !fetchError && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 border border-dashed rounded-lg">
          <FileText className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">LPがまだありません</p>
          <Button asChild size="sm">
            <Link href="/lp/new">最初のLPを作成する</Link>
          </Button>
        </div>
      )}

      {pages.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pages.map((lp) => (
            <Link
              key={lp.id}
              href={`/lp/${lp.id}`}
              className="block border rounded-xl p-4 hover:shadow-md transition-shadow bg-card"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-semibold text-sm line-clamp-2">
                  {lp.title}
                </span>
                <Badge variant={STATUS_VARIANT[lp.status] ?? "secondary"}>
                  {STATUS_LABEL[lp.status] ?? lp.status}
                </Badge>
              </div>
              <div className="mb-4 flex items-center justify-between gap-2">
                <p className="truncate font-mono text-xs text-muted-foreground">
                  /p/{lp.slug}
                </p>
                {lp.status === "published" && (
                  <CopyLpUrlButton path={`/p/${lp.slug}`} />
                )}
              </div>
              <ConversionBar views={lp.views} conversions={lp.conversions} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

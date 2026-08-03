import Link from "next/link";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { getSessionProfile } from "@/features/auth/session";
import { redirect } from "next/navigation";
import { softFail } from "@/lib/observability/soft-fail";
import { listPublishedCourses } from "@/lib/repositories/courses-public";
import {
  getCustomerIdByUserId,
  getCompletedCountsByCourse,
} from "@/lib/repositories/progress";
import { hasPaidPurchase } from "@/lib/repositories/purchases";
import { getStripeSettingsMasked } from "@/lib/repositories/stripe-settings";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { payment?: string };
}

export default async function MyPage({ searchParams }: Props) {
  const session = await getSessionProfile();
  if (!session || session.role !== "customer") redirect("/login");
  if (!session.clientId) {
    return (
      <p className="text-sm text-muted-foreground">
        クライアント情報が取得できませんでした。管理者へお問い合わせください。
      </p>
    );
  }

  const [courses, customerId, stripeSettings] = await Promise.all([
    listPublishedCourses(session.clientId).catch(softFail("コース一覧", [])),
    getCustomerIdByUserId(session.userId),
    getStripeSettingsMasked(session.clientId).catch(softFail("Stripe設定", null)),
  ]);

  if (courses.length === 0) {
    // 「コースが未作成」と「アプリが見ているテナント／DBが想定と違う」は
    // 画面上まったく同じに見える。突き合わせに必要なIDだけ残す
    // （どちらもUUIDで、個人情報は含まない）。
    console.warn(
      `[my] 公開コース0件 (client=${session.clientId}, wl=${session.whiteLabelId})`,
    );
  }

  const completedCounts = customerId
    ? await getCompletedCountsByCourse(customerId).catch(
        () => new Map<string, number>(),
      )
    : new Map<string, number>();

  // Stripe が有効かつ顧客が customerId を持つ場合のみ購入チェック
  const stripeEnabled = !!(stripeSettings?.hasSecretKey);
  const isPaid =
    stripeEnabled && customerId
      ? await hasPaidPurchase(customerId, session.clientId).catch(() => false)
      : true; // Stripe 未設定なら無料アクセス

  const paymentSuccess = searchParams.payment === "success";

  return (
    <div className="flex flex-col gap-8">
      {/* 決済完了バナー */}
      {paymentSuccess && (
        <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-green-800">お支払いが完了しました！</p>
            <p className="text-xs text-green-700 mt-0.5">
              ご登録のメールアドレスにマイページへのご案内をお送りしました。
            </p>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">
          ようこそ、{session.displayName ?? session.email} さん
        </h1>
        <p className="text-sm text-muted-foreground">{session.email}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">受講できるコース</h2>

        {/* Stripe 有効かつ未購入の場合 */}
        {stripeEnabled && !isPaid && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            コースへのアクセスには購入が必要です。LP ページから商品をお申し込みください。
          </div>
        )}

        {courses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <BookOpen className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">現在受講できるコースはありません。</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => {
              const total = course.lessonCount ?? 0;
              const done = completedCounts.get(course.id) ?? 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const locked = stripeEnabled && !isPaid;

              const card = (
                <div
                  className={`flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors ${
                    locked
                      ? "opacity-60 cursor-not-allowed"
                      : "hover:bg-accent/50 cursor-pointer"
                  }`}
                >
                  {locked && (
                    <span className="text-xs font-medium text-amber-700 bg-amber-100 rounded px-2 py-0.5 self-start">
                      🔒 購入が必要
                    </span>
                  )}
                  <p className="font-medium leading-snug line-clamp-2">{course.title}</p>
                  {course.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {course.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-auto pt-2">
                    <p className="text-xs text-muted-foreground">{total} レッスン</p>
                    {!locked && total > 0 && (
                      <Badge
                        variant={pct === 100 ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {pct === 100 ? "✅ 完了" : `${done}/${total} 完了`}
                      </Badge>
                    )}
                  </div>
                  {!locked && total > 0 && (
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );

              return locked ? (
                <div key={course.id}>{card}</div>
              ) : (
                <Link key={course.id} href={`/my/courses/${course.id}`}>
                  {card}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

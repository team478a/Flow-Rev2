import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { getStripeSettingsMaskedForWhiteLabel } from "@/lib/repositories/stripe-settings";
import { StripeSettingsForm } from "@/features/stripe/components/stripe-settings-form";
import { saveWlStripeSettingsAction } from "@/features/wl/settings-actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Stripe 共通設定 | FlowRev WL",
};

export default async function WlStripeSettingsPage() {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return (
      <p className="text-sm text-muted-foreground">
        OEM情報が取得できませんでした。管理者にお問い合わせください。
      </p>
    );
  }

  const current = await getStripeSettingsMaskedForWhiteLabel(
    session.whiteLabelId,
  ).catch(() => null);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stripe 共通設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配下クライアントが自前のStripe設定を持たない場合に、ここで設定した内容が使われます。
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">API 設定</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            この設定を使うクライアントの決済は、すべてこのStripeアカウントで処理されます。
          </p>
        </div>
        <StripeSettingsForm
          current={current}
          action={saveWlStripeSettingsAction}
          showInheritanceNotice={false}
          showConnectionTest={false}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">設定時の注意</h2>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
          <li>
            クライアントが自分でStripe設定を登録している場合は、そちらが優先されます。
          </li>
          <li>
            クライアントが未設定の場合に、この共通設定が使われます。さらに未設定なら本部の共通設定にフォールバックします。
          </li>
          <li>
            <strong className="text-foreground">
              Webhook シークレットを必ず設定してください。
            </strong>
            未設定のままでは決済完了通知を受け取れず、購入者への商品アクセス権付与が行われません。
          </li>
          <li>
            Webhook エンドポイントは Stripe ダッシュボードで{" "}
            <code className="bg-muted px-1 rounded text-xs">/api/webhooks/stripe</code>{" "}
            を登録してください。
          </li>
        </ul>
      </section>
    </div>
  );
}

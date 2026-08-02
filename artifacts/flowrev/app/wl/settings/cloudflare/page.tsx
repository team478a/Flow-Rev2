import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { CloudflareSettingsForm } from "@/features/admin/components/cloudflare-settings-form";
import { getCloudflareSettingsMaskedForWhiteLabel } from "@/lib/repositories/cloudflare-settings";
import { saveWlCloudflareSettingAction } from "@/features/wl/settings-actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cloudflare 共通設定 | FlowRev WL",
};

export default async function WlCloudflareSettingsPage() {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return (
      <p className="text-sm text-muted-foreground">
        OEM情報が取得できませんでした。管理者にお問い合わせください。
      </p>
    );
  }

  const current = await getCloudflareSettingsMaskedForWhiteLabel(
    session.whiteLabelId,
  ).catch(() => null);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Cloudflare 共通設定
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配下クライアントの動画ホスティング（Cloudflare
          Stream）に使う設定です。未設定の場合は本部の共通設定が使われます。
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">Cloudflare Stream 設定</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cloudflare ダッシュボードのアカウントIDと、Stream権限を持つAPIトークンを入力してください。
          </p>
        </div>
        <CloudflareSettingsForm
          current={current}
          action={saveWlCloudflareSettingAction}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">Webhook について</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Cloudflare Stream の Webhook（トランスコード完了通知）は、現状
          <strong className="text-foreground">本部の共通設定のみ</strong>
          が使われます。受信時点では送信元のテナントを特定できず、署名検証より先にペイロードを読む必要が生じるためです。
          OEM単位のCloudflareアカウントで動画を運用する場合は、Webhookの扱いについて本部にご相談ください。
        </p>
      </section>
    </div>
  );
}

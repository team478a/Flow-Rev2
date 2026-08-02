import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { getLineSettingsMaskedForWhiteLabel } from "@/lib/repositories/line-settings";
import { LineSettingsForm } from "@/features/line/components/line-settings-form";
import { saveWlLineSettingsAction } from "@/features/wl/settings-actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "LINE 共通設定 | FlowRev WL",
};

export default async function WlLineSettingsPage() {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return (
      <p className="text-sm text-muted-foreground">
        OEM情報が取得できませんでした。管理者にお問い合わせください。
      </p>
    );
  }

  const current = await getLineSettingsMaskedForWhiteLabel(
    session.whiteLabelId,
  ).catch(() => null);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">LINE 共通設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配下クライアントが自前のLINE設定を持たない場合に、ここで設定した内容が使われます。
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">API 設定</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            LINE Developers Console で作成した Messaging API チャネルの情報を入力してください。
          </p>
        </div>
        <LineSettingsForm
          current={current}
          action={saveWlLineSettingsAction}
          showInheritanceNotice={false}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">適用される範囲</h2>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
          <li>
            クライアントが自分でLINE設定を登録している場合は、そちらが優先されます。
          </li>
          <li>
            クライアントが未設定の場合に、この共通設定が使われます。
          </li>
          <li>
            この共通設定も未設定の場合は、本部の共通設定にフォールバックします。
          </li>
        </ul>
      </section>
    </div>
  );
}

import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { EmailSettingsForm } from "@/features/admin/components/email-settings-form";
import { getWlEmailSettingMasked } from "@/lib/repositories/email-settings";
import { saveWlEmailSettingAction } from "@/features/wl/settings-actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "メール共通設定 | FlowRev WL",
};

export default async function WlEmailSettingsPage() {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return (
      <p className="text-sm text-muted-foreground">
        OEM情報が取得できませんでした。管理者にお問い合わせください。
      </p>
    );
  }

  const current = await getWlEmailSettingMasked(session.whiteLabelId).catch(
    () => null,
  );

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">メール共通設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配下クライアントからのメール送信に使うResendの設定です。未設定の場合は本部の共通設定が使われます。
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">Resend 設定</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Resend の API キーと、送信元として表示されるアドレス・名前を入力してください。
          </p>
        </div>
        <EmailSettingsForm current={current} action={saveWlEmailSettingAction} />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">設定時の注意</h2>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
          <li>
            送信元アドレスのドメインは、Resend側でドメイン認証を済ませておく必要があります。未認証のドメインからは送信できません。
          </li>
          <li>
            ここで設定した送信元は、配下クライアントが送るフォロー配信・通知メールに使われます。
          </li>
          <li>
            APIキーを変更しない場合は、キー欄を空のまま保存すると既存のキーが維持されます。
          </li>
        </ul>
      </section>
    </div>
  );
}

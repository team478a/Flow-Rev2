import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { AuthTemplateForm } from "@/features/admin/components/auth-template-form";
import { saveWlAuthTemplateAction } from "@/features/auth-templates/actions";
import { getAuthEmailTemplateForEdit } from "@/lib/repositories/auth-email-templates";
import {
  WL_EDITABLE_TEMPLATE_KEYS,
  AUTH_TEMPLATE_LABELS,
  AUTH_TEMPLATE_DESCRIPTIONS,
} from "@/lib/email/auth-templates";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "認証メール文面 | FlowRev WL",
};

export default async function WlAuthEmailsPage() {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return (
      <p className="text-sm text-muted-foreground">
        OEM情報が取得できませんでした。管理者にお問い合わせください。
      </p>
    );
  }

  const templates = await Promise.all(
    WL_EDITABLE_TEMPLATE_KEYS.map(async (key) => ({
      key,
      current: await getAuthEmailTemplateForEdit(session.whiteLabelId!, key),
    })),
  );

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">認証メール文面</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配下クライアントの顧客へ送られる認証メールの文面です。未設定の場合は本部の共通テンプレートが使われます。
        </p>
      </div>

      {templates.map(({ key, current }) => (
        <section
          key={key}
          className="rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="mb-5 pb-4 border-b border-border">
            <h2 className="text-base font-semibold">
              {AUTH_TEMPLATE_LABELS[key]}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {AUTH_TEMPLATE_DESCRIPTIONS[key]}
            </p>
          </div>
          <AuthTemplateForm
            templateKey={key}
            current={current}
            action={saveWlAuthTemplateAction}
            scope="white_label"
          />
        </section>
      ))}

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">設定時の注意</h2>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
          <li>
            送信には「メール共通設定」のResendが使われます。未登録の場合、文面を設定しても認証メールは届きません。
          </li>
          <li>
            本文には必ず <code className="font-mono">{"{{link}}"}</code>{" "}
            を含めてください。認証リンクが無いと、受け取った方が手続きを完了できません。
          </li>
          <li>
            パスワードリセットはログイン前の操作でOEMを特定できないため、本部の文面で送られます。この画面では変更できません。
          </li>
        </ul>
      </section>
    </div>
  );
}

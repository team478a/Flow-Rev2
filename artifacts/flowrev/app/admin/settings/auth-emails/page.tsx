import { requireSystemAdmin } from "@/features/admin/guard";
import { AuthTemplateForm } from "@/features/admin/components/auth-template-form";
import { saveHqAuthTemplateAction } from "@/features/auth-templates/actions";
import { getAuthEmailTemplateForEdit } from "@/lib/repositories/auth-email-templates";
import {
  AUTH_TEMPLATE_KEYS,
  AUTH_TEMPLATE_LABELS,
  AUTH_TEMPLATE_DESCRIPTIONS,
} from "@/lib/email/auth-templates";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "認証メール文面 | FlowRev",
};

export default async function AdminAuthEmailsPage() {
  await requireSystemAdmin();

  const templates = await Promise.all(
    AUTH_TEMPLATE_KEYS.map(async (key) => ({
      key,
      current: await getAuthEmailTemplateForEdit(null, key),
    })),
  );

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">認証メール文面</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          本部の共通テンプレートです。OEMが独自に設定していない場合、こちらが使われます。
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
            action={saveHqAuthTemplateAction}
            scope="hq"
          />
        </section>
      ))}

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">設定時の注意</h2>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
          <li>
            ここでの変更は、独自の文面を設定していないすべてのOEMに反映されます。
          </li>
          <li>
            送信にはメール設定（Resend）が使われます。未登録の場合、文面を設定しても認証メールは届きません。
          </li>
          <li>
            本文には必ず <code className="font-mono">{"{{link}}"}</code>{" "}
            を含めてください。認証リンクが無いと、受け取った方が手続きを完了できません。
          </li>
          <li>
            Supabase側のメールテンプレートは使われなくなりました。文面の変更はこの画面で行ってください。
          </li>
        </ul>
      </section>
    </div>
  );
}

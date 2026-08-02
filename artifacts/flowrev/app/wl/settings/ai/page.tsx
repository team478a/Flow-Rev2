import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { AiSettingsForm } from "@/features/admin/components/ai-settings-form";
import { getWlAiSettingMasked } from "@/lib/repositories/ai-settings";
import {
  saveWlAnthropicSettingAction,
  saveWlOpenAiSettingAction,
} from "@/features/wl/settings-actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI 共通設定 | FlowRev WL",
};

export default async function WlAiSettingsPage() {
  const session = await requireWhiteLabelOwner();
  if (!session.whiteLabelId) {
    return (
      <p className="text-sm text-muted-foreground">
        OEM情報が取得できませんでした。管理者にお問い合わせください。
      </p>
    );
  }

  const [anthropic, openai] = await Promise.all([
    getWlAiSettingMasked(session.whiteLabelId, "anthropic").catch(() => null),
    getWlAiSettingMasked(session.whiteLabelId, "openai").catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI 共通設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配下クライアントのAI生成機能で使われるAPIキーを設定します。未設定の場合は本部の共通設定が使われます。
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">Anthropic（Claude）</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Anthropic Console の API キーを入力してください。
          </p>
        </div>
        <AiSettingsForm
          current={anthropic}
          action={saveWlAnthropicSettingAction}
          keyPlaceholder="sk-ant-..."
          modelPlaceholder="claude-sonnet-4-5"
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">OpenAI</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            OpenAI Platform の API キーを入力してください。
          </p>
        </div>
        <AiSettingsForm
          current={openai}
          action={saveWlOpenAiSettingAction}
          keyPlaceholder="sk-..."
          modelPlaceholder="gpt-4o"
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 pb-4 border-b border-border">
          <h2 className="text-base font-semibold">適用される範囲</h2>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
          <li>ここで設定したキーは、配下クライアント全体のAI生成で使われます。</li>
          <li>未設定の場合は本部の共通設定にフォールバックします。</li>
          <li>利用量・課金はこのAPIキーの発行元アカウントに計上されます。</li>
        </ul>
      </section>
    </div>
  );
}

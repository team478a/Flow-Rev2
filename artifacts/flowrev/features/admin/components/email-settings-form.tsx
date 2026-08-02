"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  saveEmailSettingAction,
  type SaveEmailSettingState,
} from "../actions";
import type { EmailSettingMasked } from "@/lib/repositories/email-settings";

const initialState: SaveEmailSettingState = { error: null, success: false };

const inputClass =
  "h-11 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium text-foreground";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "保存中..." : "メール設定を保存"}
    </button>
  );
}

export function EmailSettingsForm({
  current,
  action = saveEmailSettingAction,
}: {
  current: EmailSettingMasked | null;
  /**
   * 保存に使うServer Action。省略時はHQ共通設定を保存する。
   * OEM共通設定の画面（/wl/settings/email）は自OEM行を書き込むactionを渡す。
   */
  action?: (
    prev: SaveEmailSettingState,
    formData: FormData,
  ) => Promise<SaveEmailSettingState>;
}) {
  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {current?.hasApiKey && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          現在 APIキーは登録済みです（保護のため表示されません）。更新する場合のみ新しいキーを入力してください。
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="apiKey" className={labelClass}>
          Resend APIキー <span className="text-destructive">*</span>
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder="re_..."
          required
          className={inputClass}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fromEmail" className={labelClass}>
            送信元メールアドレス <span className="text-destructive">*</span>
          </label>
          <input
            id="fromEmail"
            name="fromEmail"
            type="email"
            autoComplete="off"
            placeholder="onboarding@resend.dev"
            defaultValue={current?.fromEmail ?? ""}
            required
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fromName" className={labelClass}>
            送信者名
          </label>
          <input
            id="fromName"
            name="fromName"
            placeholder="FlowRev"
            defaultValue={current?.fromName ?? ""}
            className={inputClass}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        独自ドメインで送信するには Resend
        でのドメイン認証が必要です。未認証の間はテスト用
        <code className="mx-1 rounded bg-muted px-1">onboarding@resend.dev</code>
        を利用できます。
      </p>

      {state?.error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          メール設定を保存しました。
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

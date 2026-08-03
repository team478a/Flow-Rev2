"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  AUTH_TEMPLATE_PLACEHOLDERS,
  type AuthTemplateKey,
} from "@/lib/email/auth-templates";
import type { AuthTemplateRow } from "@/lib/repositories/auth-email-templates";

export interface SaveAuthTemplateState {
  error: string | null;
  success: boolean;
}

const initialState: SaveAuthTemplateState = { error: null, success: false };

const inputClass =
  "h-11 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium text-foreground";

const TIER_NOTE: Record<AuthTemplateRow["tier"], string> = {
  white_label: "この内容は自OEM専用として保存されています。",
  hq: "現在は本部の共通テンプレートを継承しています。保存すると自OEM専用の内容になります。",
  default: "現在はFlowRevの既定テンプレートを使用しています。保存すると専用の内容になります。",
};

const HQ_TIER_NOTE: Record<AuthTemplateRow["tier"], string> = {
  white_label: "",
  hq: "この内容は本部の共通テンプレートとして保存されています。未設定のOEMすべてに使われます。",
  default:
    "現在はFlowRevの既定テンプレートを使用しています。保存すると本部の共通テンプレートになります。",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "保存中..." : "テンプレートを保存"}
    </button>
  );
}

export function AuthTemplateForm({
  templateKey,
  current,
  action,
  scope,
}: {
  templateKey: AuthTemplateKey;
  current: AuthTemplateRow;
  action: (
    prev: SaveAuthTemplateState,
    formData: FormData,
  ) => Promise<SaveAuthTemplateState>;
  /** 本部の共通テンプレートを編集する画面か、OEM専用を編集する画面か */
  scope: "hq" | "white_label";
}) {
  const [state, formAction] = useFormState(action, initialState);
  const note =
    scope === "hq" ? HQ_TIER_NOTE[current.tier] : TIER_NOTE[current.tier];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="templateKey" value={templateKey} />

      {note && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {note}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`subject-${templateKey}`} className={labelClass}>
          件名 <span className="text-destructive">*</span>
        </label>
        <input
          id={`subject-${templateKey}`}
          name="subject"
          type="text"
          required
          defaultValue={current.subject}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`bodyHtml-${templateKey}`} className={labelClass}>
          本文（HTML） <span className="text-destructive">*</span>
        </label>
        <textarea
          id={`bodyHtml-${templateKey}`}
          name="bodyHtml"
          required
          rows={14}
          defaultValue={current.bodyHtml}
          spellCheck={false}
          className="rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
        <p className="text-xs font-medium text-foreground">使える差し込み</p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {AUTH_TEMPLATE_PLACEHOLDERS.map((p) => (
            <li key={p.token} className="text-xs text-muted-foreground">
              <code className="rounded bg-background px-1 py-0.5 font-mono">
                {p.token}
              </code>{" "}
              {p.description}
            </li>
          ))}
        </ul>
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          保存しました。
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

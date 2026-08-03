"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  updateWhiteLabelAction,
  type UpdateWhiteLabelState,
} from "../actions";
import type { PlanOption } from "@/lib/repositories/plans";
import type { WhiteLabelDetail } from "@/lib/repositories/white-labels";

const initialState: UpdateWhiteLabelState = { error: null, success: false };

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
      {pending ? "保存中..." : "保存する"}
    </button>
  );
}

interface Props {
  wl: WhiteLabelDetail;
  plans: PlanOption[];
}

export function WhiteLabelEditForm({ wl, plans }: Props) {
  const boundAction = updateWhiteLabelAction.bind(null, wl.id);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="brandName" className={labelClass}>
          ブランド名 <span className="text-destructive">*</span>
        </label>
        <input
          id="brandName"
          name="brandName"
          required
          defaultValue={wl.brandName}
          className={inputClass}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="planId" className={labelClass}>
            プラン
          </label>
          <select id="planId" name="planId" defaultValue={wl.planId ?? ""} className={inputClass}>
            <option value="">未選択</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（¥{p.priceMonthly.toLocaleString()}/月）
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className={labelClass}>
            ステータス
          </label>
          <select id="status" name="status" defaultValue={wl.status} className={inputClass}>
            <option value="active">アクティブ</option>
            <option value="suspended">停止中</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brandColor" className={labelClass}>
          ブランドカラー
        </label>
        <input
          id="brandColor"
          name="brandColor"
          type="color"
          defaultValue={wl.brandColor ?? "#3B82F6"}
          className="h-11 w-20 cursor-pointer rounded-md border border-input bg-background px-1"
        />
      </div>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          ブランド表示
        </legend>
        <p className="-mt-1 text-xs text-muted-foreground">
          設定した内容は、この代理店の管理画面と配下クライアントの画面に表示されます。
          未設定の項目は本部（FlowRev）の既定表示が使われます。
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="brandLogoUrl" className={labelClass}>
            ロゴ画像URL
          </label>
          <input
            id="brandLogoUrl"
            name="brandLogoUrl"
            type="url"
            defaultValue={wl.brandLogoUrl ?? ""}
            placeholder="https://example.com/logo.png"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="brandFaviconUrl" className={labelClass}>
            ファビコンURL
          </label>
          <input
            id="brandFaviconUrl"
            name="brandFaviconUrl"
            type="url"
            defaultValue={wl.brandFaviconUrl ?? ""}
            placeholder="https://example.com/favicon.ico"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="brandDomain" className={labelClass}>
            独自ドメイン
          </label>
          <input
            id="brandDomain"
            name="brandDomain"
            defaultValue={wl.brandDomain ?? ""}
            placeholder="app.example.com"
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">
            記録用の項目です。実際のドメイン割り当てはVercel側の設定が別途必要です。
          </p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          事業者情報
        </legend>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="companyName" className={labelClass}>
            運営会社名
          </label>
          <input
            id="companyName"
            name="companyName"
            defaultValue={wl.companyName ?? ""}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="supportEmail" className={labelClass}>
            問い合わせ先メールアドレス
          </label>
          <input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={wl.supportEmail ?? ""}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="termsUrl" className={labelClass}>
            利用規約URL
          </label>
          <input
            id="termsUrl"
            name="termsUrl"
            type="url"
            defaultValue={wl.termsUrl ?? ""}
            placeholder="https://example.com/terms"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="privacyUrl" className={labelClass}>
            プライバシーポリシーURL
          </label>
          <input
            id="privacyUrl"
            name="privacyUrl"
            type="url"
            defaultValue={wl.privacyUrl ?? ""}
            placeholder="https://example.com/privacy"
            className={inputClass}
          />
        </div>
      </fieldset>

      {state?.error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton />
        <Link
          href="/admin/white-labels"
          className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          キャンセル
        </Link>
      </div>
    </form>
  );
}

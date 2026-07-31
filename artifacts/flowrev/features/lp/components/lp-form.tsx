"use client";

import { useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AiGenerateButton } from "@/features/ai/components/ai-generate-button";
import { LpHtmlEditor } from "@/features/lp/components/lp-html-editor";
import type { LpActionState } from "@/features/lp/actions";
import type { LandingPageRow } from "@/lib/repositories/landing-pages";
import type { ProductRow } from "@/lib/repositories/products";
import { generateLpCss, isValidHexColor } from "@/lib/ai/lp-design-system";

interface LpFormProps {
  action: (prev: LpActionState, formData: FormData) => Promise<LpActionState>;
  defaultValues?: Partial<LandingPageRow>;
  products: Pick<ProductRow, "id" | "name">[];
  submitLabel: string;
  successPath?: string;
}

const initialState: LpActionState = { error: null, success: false };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

export function LpForm({
  action,
  defaultValues,
  products,
  submitLabel,
  successPath,
}: LpFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [htmlContent, setHtmlContent] = useState(
    defaultValues?.htmlContent ?? "",
  );
  const [state, formAction] = useFormState(action, initialState);

  // ウィザードで生成されたLPを開いた場合、design_* 列からプレビュー用CSSを
  // 再生成する（htmlContent 自体には <style> が含まれないため）。
  const { designStyleName, designColorPrimary, designColorBg, designColorAccent } =
    defaultValues ?? {};
  const extraCss =
    designStyleName &&
    designColorPrimary &&
    designColorBg &&
    designColorAccent &&
    [designColorPrimary, designColorBg, designColorAccent].every(isValidHexColor)
      ? generateLpCss(
          { primary: designColorPrimary, bg: designColorBg, accent: designColorAccent },
          designStyleName,
        )
      : undefined;

  useEffect(() => {
    if (state.success === true && successPath) {
      router.push(successPath);
    }
  }, [state.success, router, successPath]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {state.error}
        </p>
      )}

      {/* 基本情報 */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">タイトル *</Label>
          <Input
            id="title"
            name="title"
            placeholder="例：無料相談申し込みページ"
            defaultValue={defaultValues?.title ?? ""}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slug">
            スラッグ *
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              /p/スラッグ
            </span>
          </Label>
          <Input
            id="slug"
            name="slug"
            placeholder="例：free-consultation"
            defaultValue={defaultValues?.slug ?? ""}
            required
          />
          <p className="text-xs text-muted-foreground">半角英数字・ハイフンのみ</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productId">紐付け商品（任意）</Label>
          <Select name="productId" defaultValue={defaultValues?.productId ?? "none"}>
            <SelectTrigger id="productId">
              <SelectValue placeholder="商品を選択（任意）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">紐付けなし</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">ステータス *</Label>
          <Select name="status" defaultValue={defaultValues?.status ?? "draft"}>
            <SelectTrigger id="status">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">下書き</SelectItem>
              <SelectItem value="published">公開</SelectItem>
              <SelectItem value="archived">アーカイブ</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* LINE 友だち追加 URL */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lineAddUrl">LINE 友だち追加 URL（任意）</Label>
        <Input
          id="lineAddUrl"
          name="lineAddUrl"
          type="url"
          placeholder="https://lin.ee/xxxxxxxx"
          defaultValue={defaultValues?.lineAddUrl ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          入力すると LP ページに「LINE を友だち追加する」ボタンが表示されます。
        </p>
      </div>

      {/* HTML本文 + プレビュー */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>HTML本文</Label>
          <AiGenerateButton
            endpoint="/api/ai/generate-lp"
            buildPayload={() => {
              const fd = formRef.current ? new FormData(formRef.current) : new FormData();
              const title = String(fd.get("title") ?? "");
              const productId = String(fd.get("productId") ?? "");
              const product = products.find((p) => p.id === productId);
              return { title, productName: product?.name ?? "" };
            }}
            onGenerated={(text) => setHtmlContent(text)}
          />
        </div>

        <LpHtmlEditor
          id="htmlContent"
          name="htmlContent"
          value={htmlContent}
          onChange={setHtmlContent}
          extraCss={extraCss}
        />
        <p className="text-xs text-muted-foreground">
          HTMLタグを直接入力できます。右パネルにリアルタイムプレビューが表示されます。
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <SubmitButton label={submitLabel} />
        <Button type="button" variant="outline" onClick={() => router.back()}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

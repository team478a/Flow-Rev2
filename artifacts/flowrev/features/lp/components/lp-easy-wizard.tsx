"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Sparkles, Eye, Loader2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LpActionState } from "@/features/lp/actions";
import type { ProductRow } from "@/lib/repositories/products";
import {
  LpDesignPicker,
  COLOR_THEMES,
  type ColorThemeId,
  type DesignStyleId,
} from "@/features/lp/components/lp-design-picker";
import { LpHeroImagePicker } from "@/features/lp/components/lp-hero-image-picker";
import { generateLpCss } from "@/lib/ai/lp-design-system";

type Product = Pick<ProductRow, "id" | "name">;

interface LpEasyWizardProps {
  action: (prev: LpActionState, formData: FormData) => Promise<LpActionState>;
  products: Product[];
}

function injectHeroImage(html: string, url: string | null): string {
  if (!url) return html;
  const img = `<img src="${url}" alt="ヒーロー画像" style="width:100%;max-height:380px;object-fit:cover;border-radius:8px;margin:20px 0;display:block;">`;
  return html.includes("<!-- HERO_IMAGE -->")
    ? html.replace("<!-- HERO_IMAGE -->", img)
    : html.replace("</h1>", `</h1>\n${img}`);
}

function toSlug(text: string): string {
  const ts = Date.now().toString(36);
  const ascii = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ascii.length > 2 ? `${ascii.slice(0, 24)}-${ts}` : `lp-${ts}`;
}

/**
 * プレビュー用ドキュメントを構築する。
 * デザインCSSは（AIが生成する本文HTMLとは別に）このコンポーネント自身が選択中の
 * テーマから生成する信頼できる文字列であり、保存後も landing_pages の別列
 * （design_style_name 等）から同じ関数で再生成されるため、プレビューと公開後の
 * 見た目が一致する（docs/audit/05_SECURITY_FINDINGS.md L-2 の修正）。
 */
function buildPreviewDoc(bodyHtml: string, css: string): string {
  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;}body{margin:0;}img{max-width:100%;height:auto;}${css}</style>
</head><body>${bodyHtml}</body></html>`;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="gap-2">
      {pending ? <><Loader2 className="h-4 w-4 animate-spin" />保存中…</> : "このLPを作成する"}
    </Button>
  );
}

export function LpEasyWizard({ action, products }: LpEasyWizardProps) {
  const router = useRouter();
  const [state, formAction] = useFormState(action, { error: null });

  const [purpose, setPurpose] = useState("");
  const [target, setTarget] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [productId, setProductId] = useState("none");

  const [colorTheme, setColorTheme] = useState<ColorThemeId>("blue");
  const [designStyle, setDesignStyle] = useState<DesignStyleId>("modern");

  const [generatedHtml, setGeneratedHtml] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [referenceWarning, setReferenceWarning] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);

  const STYLE_LABELS: Record<DesignStyleId, string> = {
    modern: "モダン", natural: "ナチュラル", luxury: "高級感", pop: "ポップ", business: "ビジネス",
  };

  const theme = COLOR_THEMES.find((t) => t.id === colorTheme) ?? COLOR_THEMES[0];
  const styleName = STYLE_LABELS[designStyle];
  const css = generateLpCss(
    { primary: theme.primary, bg: theme.bg, accent: theme.accent },
    styleName,
  );

  async function handleGenerate() {
    if (!purpose.trim()) return;
    setIsGenerating(true);
    setGenerateError(null);
    setReferenceWarning(null);

    const selectedProduct = products.find((p) => p.id === productId);

    try {
      const res = await fetch("/api/ai/generate-lp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${purpose}${target ? `（ターゲット：${target}）` : ""}`,
          productName: selectedProduct?.name ?? "",
          referenceUrl: referenceUrl.trim() || undefined,
          designStyleName: styleName,
          colorPrimary: theme.primary,
          colorBg: theme.bg,
          colorAccent: theme.accent,
        }),
      });
      const data = (await res.json()) as {
        html?: string;
        error?: string;
        referenceWarning?: string;
      };
      if (!res.ok || data.error) {
        setGenerateError(data.error ?? "生成に失敗しました。");
        return;
      }
      if (data.referenceWarning) setReferenceWarning(data.referenceWarning);
      if (data.html) {
        setGeneratedHtml(data.html);
        if (!title) setTitle(purpose.slice(0, 50));
        if (!slug) setSlug(toSlug(purpose));
        setGenerated(true);
      }
    } catch {
      setGenerateError("ネットワークエラーが発生しました。");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      {/* Step 1：情報入力 */}
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">1</span>
          LP の目的とデザインを設定する
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ez-purpose">
            何のLPを作りますか？ <span className="text-red-500 text-xs">必須</span>
          </Label>
          <Textarea
            id="ez-purpose"
            placeholder="例：無料体験セミナーの参加者を集める"
            rows={3}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ez-target">ターゲット（任意）</Label>
          <Input
            id="ez-target"
            placeholder="例：副業を始めたい30代の会社員"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>

        {/* デザイン設定 */}
        <LpDesignPicker
          colorTheme={colorTheme}
          designStyle={designStyle}
          onColorChange={setColorTheme}
          onStyleChange={setDesignStyle}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ez-ref-url" className="flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            参考サイト URL（任意）
          </Label>
          <Input
            id="ez-ref-url"
            type="url"
            placeholder="https://example.com/lp"
            value={referenceUrl}
            onChange={(e) => setReferenceUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            競合・参考サイトの URL を入力すると、そのライティングスタイルを参考に生成します。
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ez-product">紐付ける商品（任意）</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger id="ez-product">
              <SelectValue placeholder="商品を選択" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">紐付けなし</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {referenceWarning && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            ⚠ {referenceWarning}
          </p>
        )}
        {generateError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {generateError}
          </p>
        )}

        <Button
          type="button"
          onClick={handleGenerate}
          disabled={!purpose.trim() || isGenerating}
          className="gap-2 self-start"
        >
          {isGenerating
            ? <><Loader2 className="h-4 w-4 animate-spin" />生成中…</>
            : <><Sparkles className="h-4 w-4" />{generated ? "再生成する" : "AIでデザイン済みLPを生成する"}</>}
        </Button>
      </section>

      {/* Step 2：プレビュー＋保存 */}
      {generated && (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">2</span>
            確認・保存する
          </div>

          <div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
              <Eye className="h-3 w-3" /> プレビュー（実際の公開ページと同じデザイン）
            </p>
            <div className="rounded-md border border-border overflow-hidden bg-white">
              <iframe
                srcDoc={buildPreviewDoc(generatedHtml, css)}
                className="w-full"
                style={{ height: "480px" }}
                sandbox="allow-same-origin"
                title="生成されたLPのプレビュー"
              />
            </div>
          </div>

          {/* ヒーロー画像設定 */}
          <LpHeroImagePicker imageUrl={heroImageUrl} onImageUrl={setHeroImageUrl} />

          {state.error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {state.error}
            </p>
          )}

          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="htmlContent" value={injectHeroImage(generatedHtml, heroImageUrl)} />
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="designStyleName" value={styleName} />
            <input type="hidden" name="colorPrimary" value={theme.primary} />
            <input type="hidden" name="colorBg" value={theme.bg} />
            <input type="hidden" name="colorAccent" value={theme.accent} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ez-title">LPタイトル <span className="text-red-500 text-xs">必須</span></Label>
              <Input id="ez-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ez-slug">
                スラッグ <span className="text-red-500 text-xs">必須</span>
                <span className="ml-2 text-xs text-muted-foreground font-normal">（公開URL: /p/スラッグ）</span>
              </Label>
              <Input id="ez-slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ez-status">公開設定</Label>
              <Select name="status" defaultValue="draft">
                <SelectTrigger id="ez-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">下書き（後で公開）</SelectItem>
                  <SelectItem value="published">今すぐ公開</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3">
              <SaveButton />
              <Button type="button" variant="outline" onClick={() => router.back()}>
                キャンセル
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { ImagePlus, Sparkles, Loader2, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LpHeroImagePickerProps {
  imageUrl: string | null;
  onImageUrl: (url: string | null) => void;
}

type Mode = "idle" | "ai-form" | "loading-upload" | "loading-ai";

export function LpHeroImagePicker({ imageUrl, onImageUrl }: LpHeroImagePickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [aiPrompt, setAiPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isLoading = mode === "loading-upload" || mode === "loading-ai";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMode("loading-upload");
    setError(null);
    e.target.value = "";
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/lp/upload-image", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "アップロードに失敗しました。");
      onImageUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました。");
    } finally {
      setMode("idle");
    }
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setMode("loading-ai");
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "生成に失敗しました。");
      onImageUrl(data.url);
      setAiPrompt("");
      setMode("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました。");
      setMode("ai-form");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">ヒーロー画像（任意）</p>

      {/* 画像プレビュー */}
      {imageUrl ? (
        <div className="relative rounded-lg overflow-hidden border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="ヒーロー画像" className="w-full max-h-48 object-cover" />
          <button
            type="button"
            onClick={() => onImageUrl(null)}
            className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
            title="画像を削除"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/30 py-8 px-4">
          <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center">
            LP のヒーローセクションに表示する画像を設定できます（設定しない場合は文字のみ）
          </p>

          <div className="flex gap-2 flex-wrap justify-center">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              {mode === "loading-upload"
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ImagePlus className="h-4 w-4" />}
              画像をアップロード
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => { setMode("ai-form"); setError(null); }}
              className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              {mode === "loading-ai"
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Sparkles className="h-4 w-4" />}
              AIで画像を生成
            </button>
          </div>

          {mode === "ai-form" && (
            <div className="flex w-full max-w-md gap-2">
              <Input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例：明るいオフィスで笑顔の人たち"
                className="text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAiGenerate(); } }}
                autoFocus
              />
              <Button type="button" size="sm" disabled={!aiPrompt.trim()} onClick={handleAiGenerate} className="gap-1.5 shrink-0">
                <Sparkles className="h-3.5 w-3.5" />
                生成
              </Button>
              <button type="button" onClick={() => setMode("idle")} className="text-xs text-muted-foreground hover:text-foreground px-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 既に画像がある場合の変更ボタン */}
      {imageUrl && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2.5 py-1 bg-background hover:bg-accent transition-colors"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            別の画像にする
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileChange} />

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}
    </div>
  );
}

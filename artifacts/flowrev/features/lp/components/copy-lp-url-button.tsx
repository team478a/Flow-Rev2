"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface Props {
  /** `/p/<slug>` の相対パス。絶対URLはブラウザ側で組み立てる。 */
  path: string;
}

/**
 * 公開URLをクリップボードへコピーする。
 *
 * 絶対URLをサーバー側で組み立てないのは、リクエストヘッダから作ると
 * 環境によって違うドメインが混ざるため。ここは配布用のURLなので
 * 「いま見ているドメイン」で組み立てるのが正しい。
 */
export function CopyLpUrlButton({ path }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    // 一覧ではカード全体がリンクなので、編集画面へ遷移させない。
    e.preventDefault();
    e.stopPropagation();

    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // クリップボードが使えない環境（権限拒否・非セキュアコンテキスト）では
      // 黙って失敗させず、選択してコピーできる形にする。
      window.prompt("URLをコピーしてください", url);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="公開URLをコピー"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-600" />
          コピーしました
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          URLをコピー
        </>
      )}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";

interface Props {
  lpId: string;
  duplicateAction: (
    lpId: string,
  ) => Promise<{ error: string | null; newId?: string }>;
}

/**
 * LPを複製して、複製先の編集画面へ移動する。
 *
 * 複製は下書きで作られるため、そのまま公開されることはない。
 */
export function DuplicateLpButton({ lpId, duplicateAction }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await duplicateAction(lpId);
      if (result.error || !result.newId) {
        setError(result.error ?? "複製に失敗しました。");
        return;
      }
      router.push(`/lp/${result.newId}`);
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        複製
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

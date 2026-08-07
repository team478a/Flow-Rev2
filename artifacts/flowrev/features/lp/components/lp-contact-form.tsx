"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Send, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LpContactFormProps {
  lpId: string;
  isPaid?: boolean;
}

export function LpContactForm({ lpId, isPaid = false }: LpContactFormProps) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 流入元はページを開いた時点で確定する。送信時に読むと、フォーム操作中に
  // URLが書き換わった場合（SPA遷移・広告ツールのパラメータ除去）に失われる。
  const attribution = useRef<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pick = (key: string) => params.get(key) ?? undefined;
    const values: Record<string, string | undefined> = {
      utmSource: pick("utm_source"),
      utmMedium: pick("utm_medium"),
      utmCampaign: pick("utm_campaign"),
      utmTerm: pick("utm_term"),
      utmContent: pick("utm_content"),
      // 同一サイト内の遷移は流入元ではないため送らない。
      referrer:
        document.referrer && !document.referrer.startsWith(window.location.origin)
          ? document.referrer
          : undefined,
    };
    attribution.current = Object.fromEntries(
      Object.entries(values).filter(([, v]) => Boolean(v)),
    ) as Record<string, string>;
  }, []);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/p/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lpId,
            email,
            name: name || undefined,
            phone: phone || undefined,
            attribution: attribution.current,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; checkoutUrl?: string };
        if (!res.ok || !data.ok) {
          setError(data.error ?? "送信に失敗しました。もう一度お試しください。");
          return;
        }
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        setDone(true);
      } catch {
        setError("ネットワークエラーが発生しました。");
      }
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
        <p className="text-lg font-semibold">ご登録ありがとうございます！</p>
        <p className="text-sm text-gray-600 max-w-xs">
          ご入力のメールアドレスにマイページへのご案内をお送りしました。
          メールをご確認のうえ、パスワードを設定してログインしてください。
        </p>
        <p className="text-xs text-gray-400">
          メールが届かない場合は迷惑メールフォルダをご確認ください。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lp-name">お名前</Label>
        <Input
          id="lp-name"
          type="text"
          placeholder="山田 太郎"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          autoComplete="name"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lp-email">
          メールアドレス <span className="text-red-500 text-xs">必須</span>
        </Label>
        <Input
          id="lp-email"
          type="email"
          placeholder="example@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isPending}
          autoComplete="email"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lp-phone">電話番号</Label>
        <Input
          id="lp-phone"
          type="tel"
          placeholder="090-0000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={isPending}
          autoComplete="tel"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending || !email} className="gap-2 w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {isPaid ? "決済画面に移動中…" : "送信中…"}
          </>
        ) : isPaid ? (
          <>
            <ShoppingCart className="h-4 w-4" />
            今すぐ購入する
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            送信する
          </>
        )}
      </Button>

      {isPaid && (
        <p className="text-center text-xs text-gray-400">
          送信後、Stripe の安全な決済画面に移動します。
        </p>
      )}
    </form>
  );
}

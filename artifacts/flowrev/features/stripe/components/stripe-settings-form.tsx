"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, Wifi, WifiOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { saveStripeSettingsAction, testStripeConnectionAction } from "@/features/stripe/actions";
import type { StripeSettingsMasked } from "@/lib/repositories/stripe-settings";

interface StripeSettingsFormProps {
  current: StripeSettingsMasked | null;
}

export function StripeSettingsForm({ current }: StripeSettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [isTesting, startTest] = useTransition();
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [isLive, setIsLive] = useState(current?.isLive ?? false);
  const [showSecret, setShowSecret] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setTestResult(null);
    startTransition(async () => {
      const fd = new FormData();
      if (secretKey) fd.append("secretKey", secretKey);
      if (webhookSecret) fd.append("webhookSecret", webhookSecret);
      fd.append("isLive", isLive ? "true" : "false");
      const result = await saveStripeSettingsAction(fd);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setSecretKey("");
        setWebhookSecret("");
      }
    });
  }

  function handleTest() {
    setTestResult(null);
    startTest(async () => {
      const result = await testStripeConnectionAction();
      setTestResult({
        ok: result.ok,
        message: result.ok ? "Stripe に正常に接続できました。" : (result.error ?? "接続失敗"),
      });
    });
  }

  const noChanges =
    !secretKey && !webhookSecret && (current?.isLive ?? false) === isLive;
  const inheritedTier =
    current && current.tier !== "client" ? current.tier : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {inheritedTier && (
        <p className="text-xs text-muted-foreground bg-muted rounded px-3 py-2">
          {inheritedTier === "white_label"
            ? "現在は代理店（OEM）の共通設定を使用しています。保存すると、この画面の内容でクライアント専用の設定に切り替わります。"
            : "現在は本部の共通設定を使用しています。保存すると、この画面の内容でクライアント専用の設定に切り替わります。"}
        </p>
      )}
      {/* テスト/本番モード */}
      <div className="flex items-center gap-3">
        <Switch
          id="is-live"
          checked={isLive}
          onCheckedChange={setIsLive}
          disabled={isPending}
        />
        <Label htmlFor="is-live" className="cursor-pointer select-none">
          本番モード
        </Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        {isLive
          ? "⚠️ 本番モード：実際の決済が発生します。"
          : "🧪 テストモード：Stripe テストキーを使用してください（sk_test_...）"}
      </p>

      {current?.hasSecretKey && !current?.hasWebhookSecret && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          ⚠️ Webhook シークレットが未設定です。この状態では決済完了通知を受け取れず、購入者への商品アクセス権付与が行われません。下記の「Webhook
          シークレット」を必ず設定してください。
        </p>
      )}

      {/* Secret Key */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="secret-key">
          Stripe シークレットキー
          {current?.hasSecretKey && (
            <span className="ml-2 text-xs text-green-600">（設定済み）</span>
          )}
        </Label>
        <div className="relative">
          <Input
            id="secret-key"
            type={showSecret ? "text" : "password"}
            placeholder={current?.hasSecretKey ? "変更する場合のみ入力" : "sk_test_..."}
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            disabled={isPending}
            className="pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowSecret((v) => !v)}
            tabIndex={-1}
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stripe ダッシュボード → 開発者 → API キー から取得できます。
        </p>
      </div>

      {/* Webhook Secret */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-secret">
          Webhook シークレット
          {current?.hasWebhookSecret && (
            <span className="ml-2 text-xs text-green-600">（設定済み）</span>
          )}
        </Label>
        <div className="relative">
          <Input
            id="webhook-secret"
            type={showWebhook ? "text" : "password"}
            placeholder={current?.hasWebhookSecret ? "変更する場合のみ入力" : "whsec_..."}
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            disabled={isPending}
            className="pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowWebhook((v) => !v)}
            tabIndex={-1}
          >
            {showWebhook ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stripe ダッシュボード → Webhook → エンドポイント追加 →{" "}
          <code className="bg-muted px-1 rounded text-xs">/api/webhooks/stripe</code>{" "}
          を登録後に表示されるシークレットを入力してください。
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>保存しました。</span>
        </div>
      )}

      {/* 接続テスト結果 */}
      {testResult && (
        <div
          className={`flex items-center gap-2 text-sm rounded px-3 py-2 border ${
            testResult.ok
              ? "text-green-700 bg-green-50 border-green-200"
              : "text-red-700 bg-red-50 border-red-200"
          }`}
        >
          {testResult.ok ? (
            <Wifi className="h-4 w-4 shrink-0" />
          ) : (
            <WifiOff className="h-4 w-4 shrink-0" />
          )}
          <span>{testResult.message}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending || noChanges}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          保存する
        </Button>

        {current?.hasSecretKey && (
          <Button
            type="button"
            variant="outline"
            disabled={isTesting}
            onClick={handleTest}
          >
            {isTesting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wifi className="mr-2 h-4 w-4" />
            )}
            接続テスト
          </Button>
        )}
      </div>
    </form>
  );
}

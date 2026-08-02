"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { saveLineSettingsAction } from "@/features/line/actions";
import type { LineSettingsMasked } from "@/lib/repositories/line-settings";

interface LineSettingsFormProps {
  current: LineSettingsMasked | null;
  /**
   * 保存に使うServer Action。省略時はクライアント単位の設定を保存する。
   * OEM共通設定の画面（/wl/settings/line）は自OEM行を書き込むactionを渡す。
   */
  action?: (formData: FormData) => Promise<{ error: string | null }>;
  /** 継承元の注記を表示するか。OEM共通設定の画面では継承元が無いため抑止する。 */
  showInheritanceNotice?: boolean;
}

export function LineSettingsForm({
  current,
  action = saveLineSettingsAction,
  showInheritanceNotice = true,
}: LineSettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [friendUrl, setFriendUrl] = useState(current?.lineFriendUrl ?? "");
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const fd = new FormData();
      if (token) fd.append("channelAccessToken", token);
      if (secret) fd.append("channelSecret", secret);
      fd.append("lineFriendUrl", friendUrl);
      const result = await action(fd);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setToken("");
        setSecret("");
      }
    });
  }

  const noChanges = !token && !secret && friendUrl === (current?.lineFriendUrl ?? "");
  const inheritedTier =
    showInheritanceNotice && current && current.tier !== "client"
      ? current.tier
      : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {inheritedTier && (
        <p className="text-xs text-muted-foreground bg-muted rounded px-3 py-2">
          {inheritedTier === "white_label"
            ? "現在は代理店（OEM）の共通設定を使用しています。保存すると、この画面の内容でクライアント専用の設定に切り替わります。"
            : "現在は本部の共通設定を使用しています。保存すると、この画面の内容でクライアント専用の設定に切り替わります。"}
        </p>
      )}
      {/* チャネルアクセストークン */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="channel-access-token">
          チャネルアクセストークン
          {current?.hasChannelAccessToken && (
            <span className="ml-2 text-xs text-green-600">（設定済み）</span>
          )}
        </Label>
        <div className="relative">
          <Input
            id="channel-access-token"
            type={showToken ? "text" : "password"}
            placeholder={current?.hasChannelAccessToken ? "変更する場合のみ入力" : "長期アクセストークンを入力"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isPending}
            className="pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowToken((v) => !v)}
            tabIndex={-1}
          >
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          LINE Developers Console → チャネル → Messaging API → チャネルアクセストークン（長期）から発行してください。
        </p>
      </div>

      {/* チャネルシークレット */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="channel-secret">
          チャネルシークレット
          {current?.hasChannelSecret && (
            <span className="ml-2 text-xs text-green-600">（設定済み）</span>
          )}
        </Label>
        <div className="relative">
          <Input
            id="channel-secret"
            type={showSecret ? "text" : "password"}
            placeholder={current?.hasChannelSecret ? "変更する場合のみ入力" : "チャネルシークレットを入力"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
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
          LINE Developers Console → チャネル基本設定 → チャネルシークレット
        </p>
      </div>

      {/* 友だち追加 URL */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="line-friend-url">LINE 友だち追加 URL（任意）</Label>
        <Input
          id="line-friend-url"
          type="url"
          placeholder="https://lin.ee/xxxxxxxx"
          value={friendUrl}
          onChange={(e) => setFriendUrl(e.target.value)}
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          LP に「LINE 友だち追加」ボタンを表示する場合に入力してください。LINE Official Account Manager → 友だちを増やす から取得できます。
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

      <div>
        <Button type="submit" disabled={isPending || noChanges}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          保存する
        </Button>
      </div>
    </form>
  );
}

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export type WebhookLogResult = "success" | "sig_error" | "db_error" | "parse_error";

export interface CloudflareWebhookLog {
  id: string;
  received_at: string;
  video_id: string | null;
  status: string | null;
  result: WebhookLogResult;
  detail: string | null;
}

export interface InsertWebhookLogInput {
  videoId?: string | null;
  status?: string | null;
  result: WebhookLogResult;
  detail?: string | null;
}

/** Webhook 受信ログを1件挿入する。エラーは握りつぶしてログのみ出す（本処理を妨げない） */
export async function insertWebhookLog(input: InsertWebhookLogInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("cloudflare_webhook_logs").insert({
      received_at: new Date().toISOString(),
      video_id: input.videoId ?? null,
      status: input.status ?? null,
      result: input.result,
      detail: input.detail ?? null,
    });
    if (error) {
      console.error("[CF Webhook Log] ログ挿入エラー:", error.message);
    }
  } catch (e) {
    console.error("[CF Webhook Log] 予期しないエラー:", e);
  }
}

/** 直近 N 件の Webhook ログを返す（管理画面用） */
export async function getRecentWebhookLogs(limit = 20): Promise<CloudflareWebhookLog[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloudflare_webhook_logs")
    .select("id, received_at, video_id, status, result, detail")
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) throwSafe("Webhook ログの取得に失敗", error);
  return (data ?? []) as CloudflareWebhookLog[];
}

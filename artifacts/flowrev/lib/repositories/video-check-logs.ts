import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface VideoCheckLog {
  id: string;
  checkedAt: string;
  unprotected: number;
  total: number;
  notified: boolean;
}

export interface VideoCheckLogsPage {
  logs: VideoCheckLog[];
  total: number;
  page: number;
  pageSize: number;
}

/** cron チェック結果を1件保存する */
export async function insertVideoCheckLog(params: {
  unprotected: number;
  total: number;
  notified: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("video_check_logs").insert({
    unprotected: params.unprotected,
    total: params.total,
    notified: params.notified,
  });
  if (error) throwSafe("チェックログの保存に失敗", error);
}

export interface VideoCheckLogChartPoint {
  label: string;
  unprotected: number;
  total: number;
}

export interface VideoCheckLogChartOptions {
  from?: string;
  to?: string;
}

/** グラフ表示用にデータを古い順で返す。from/to で日付範囲を絞り込める */
export async function getVideoCheckLogsForChart(
  options: VideoCheckLogChartOptions = {},
): Promise<VideoCheckLogChartPoint[]> {
  const admin = createAdminClient();

  let query = admin
    .from("video_check_logs")
    .select("checked_at, unprotected, total")
    .order("checked_at", { ascending: false });

  if (options.from) {
    query = query.gte("checked_at", `${options.from}T00:00:00.000Z`);
  }
  if (options.to) {
    query = query.lte("checked_at", `${options.to}T23:59:59.999Z`);
  }

  const { data, error } = await query;

  if (error) throwSafe("チャートデータの取得に失敗", error);

  const rows = ((data ?? []) as Record<string, unknown>[]).reverse();
  return rows.map((row) => {
    const date = new Date(row.checked_at as string);
    const label = date.toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      label,
      unprotected: (row.unprotected as number) ?? 0,
      total: (row.total as number) ?? 0,
    };
  });
}

/** 最新のチェックログを1件返す（admin dashboard の表示用キャッシュ） */
export async function getLatestVideoCheckLog(): Promise<VideoCheckLog | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("video_check_logs")
    .select("id, checked_at, unprotected, total, notified")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    checkedAt: row.checked_at as string,
    unprotected: (row.unprotected as number) ?? 0,
    total: (row.total as number) ?? 0,
    notified: (row.notified as boolean) ?? false,
  };
}

/** ページネーション付きでチェックログを返す（新しい順） */
export async function getVideoCheckLogsPage(
  page = 1,
  pageSize = 20,
): Promise<VideoCheckLogsPage> {
  const admin = createAdminClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await admin
    .from("video_check_logs")
    .select("id, checked_at, unprotected, total, notified", { count: "exact" })
    .order("checked_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throwSafe("チェックログの取得に失敗", error);

  const rows = (data ?? []) as Record<string, unknown>[];
  const logs: VideoCheckLog[] = rows.map((row) => ({
    id: row.id as string,
    checkedAt: row.checked_at as string,
    unprotected: (row.unprotected as number) ?? 0,
    total: (row.total as number) ?? 0,
    notified: (row.notified as boolean) ?? false,
  }));

  return { logs, total: count ?? 0, page, pageSize };
}

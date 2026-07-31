import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface CloudflareProtectLog {
  id: string;
  executedAt: string;
  executedBy: string | null;
  executorName: string | null;
  total: number;
  updated: number;
  failed: number;
  errorDetails: string[] | null;
}

/** 最新の一括保護ログを1件返す */
export async function getLatestProtectLog(): Promise<CloudflareProtectLog | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloudflare_protect_logs")
    .select("id, executed_at, executed_by, total, updated, failed, error_details")
    .order("executed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throwSafe("保護ログの取得に失敗", error);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const executedBy = (row.executed_by as string) ?? null;

  let executorName: string | null = null;
  if (executedBy) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("display_name")
      .eq("id", executedBy)
      .maybeSingle();
    executorName = (profile as Record<string, unknown> | null)?.display_name as string | null ?? null;
  }

  return {
    id: row.id as string,
    executedAt: row.executed_at as string,
    executedBy,
    executorName,
    total: (row.total as number) ?? 0,
    updated: (row.updated as number) ?? 0,
    failed: (row.failed as number) ?? 0,
    errorDetails: (row.error_details as string[] | null) ?? null,
  };
}

/** 直近の一括保護ログを最大 limit 件返す（新しい順） */
export async function getRecentProtectLogs(
  limit = 20,
): Promise<CloudflareProtectLog[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloudflare_protect_logs")
    .select("id, executed_at, executed_by, total, updated, failed")
    .order("executed_at", { ascending: false })
    .limit(limit);

  if (error) throwSafe("保護ログの取得に失敗", error);
  if (!data) return [];

  const rows = data as Record<string, unknown>[];

  const executorIds = [
    ...new Set(
      rows
        .map((r) => r.executed_by as string | null)
        .filter((id): id is string => !!id),
    ),
  ];

  const nameMap = new Map<string, string>();
  if (executorIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", executorIds);
    if (profiles) {
      for (const p of profiles as Record<string, unknown>[]) {
        const pid = p.id as string;
        const dn = (p.display_name as string | null) ?? null;
        if (pid && dn) nameMap.set(pid, dn);
      }
    }
  }

  return rows.map((row) => {
    const executedBy = (row.executed_by as string) ?? null;
    return {
      id: row.id as string,
      executedAt: row.executed_at as string,
      executedBy,
      executorName: executedBy ? (nameMap.get(executedBy) ?? null) : null,
      total: (row.total as number) ?? 0,
      updated: (row.updated as number) ?? 0,
      failed: (row.failed as number) ?? 0,
      errorDetails: null,
    };
  });
}

export interface ProtectLogsPage {
  logs: CloudflareProtectLog[];
  total: number;
  page: number;
  pageSize: number;
}

/** ページネーション付きで一括保護ログを返す（新しい順） */
export async function getProtectLogsPage(
  page = 1,
  pageSize = 20,
): Promise<ProtectLogsPage> {
  const admin = createAdminClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await admin
    .from("cloudflare_protect_logs")
    .select("id, executed_at, executed_by, total, updated, failed", {
      count: "exact",
    })
    .order("executed_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throwSafe("保護ログの取得に失敗", error);

  const rows = (data ?? []) as Record<string, unknown>[];

  const executorIds = [
    ...new Set(
      rows
        .map((r) => r.executed_by as string | null)
        .filter((id): id is string => !!id),
    ),
  ];

  const nameMap = new Map<string, string>();
  if (executorIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", executorIds);
    if (profiles) {
      for (const p of profiles as Record<string, unknown>[]) {
        const pid = p.id as string;
        const dn = (p.display_name as string | null) ?? null;
        if (pid && dn) nameMap.set(pid, dn);
      }
    }
  }

  const logs = rows.map((row) => {
    const executedBy = (row.executed_by as string) ?? null;
    return {
      id: row.id as string,
      executedAt: row.executed_at as string,
      executedBy,
      executorName: executedBy ? (nameMap.get(executedBy) ?? null) : null,
      total: (row.total as number) ?? 0,
      updated: (row.updated as number) ?? 0,
      failed: (row.failed as number) ?? 0,
      errorDetails: null,
    };
  });

  return { logs, total: count ?? 0, page, pageSize };
}

/** 一括保護の実行結果をログに保存する */
export async function insertProtectLog(params: {
  executedBy: string;
  total: number;
  updated: number;
  failed: number;
  errorDetails?: string[];
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("cloudflare_protect_logs").insert({
    executed_by: params.executedBy,
    total: params.total,
    updated: params.updated,
    failed: params.failed,
    error_details:
      params.errorDetails && params.errorDetails.length > 0
        ? params.errorDetails
        : null,
  });
  if (error) throwSafe("保護ログの保存に失敗", error);
}

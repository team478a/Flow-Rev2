import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PendingLogWithStep {
  logId: string;
  scenarioId: string;
  stepId: string;
  customerId: string;
  whiteLabelId: string;
  delayDays: number;
  createdAt: string;
  subject: string | null;
  body: string;
  channel: string;
}

/**
 * purchase トリガーのアクティブシナリオを顧客にエンキューする。
 * LP 登録直後に呼び出す（ベストエフォート）。
 */
export async function enqueuePurchaseScenarios(
  customerId: string,
  clientId: string,
  whiteLabelId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { data: scenarios } = await supabase
    .from("follow_scenarios")
    .select("id")
    .eq("client_id", clientId)
    .eq("trigger_type", "purchase")
    .eq("status", "active");

  if (!scenarios?.length) return;

  const scenarioIds = (scenarios as Record<string, unknown>[]).map(
    (s) => s.id as string,
  );

  const { data: steps } = await supabase
    .from("scenario_steps")
    .select("id, scenario_id")
    .in("scenario_id", scenarioIds)
    .order("step_number", { ascending: true });

  if (!steps?.length) return;

  const now = new Date().toISOString();
  const logs = (steps as Record<string, unknown>[]).map((step) => ({
    scenario_id: step.scenario_id as string,
    step_id: step.id as string,
    customer_id: customerId,
    white_label_id: whiteLabelId,
    status: "pending",
    created_at: now,
  }));

  await supabase.from("scenario_logs").insert(logs);
}

/**
 * 実行待ち（pending）のログとステップ情報をまとめて取得する。
 * force=true のとき delay_days を無視して全 pending を返す。
 * force=false のとき created_at + delay_days 日 <= now() のみ返す。
 *
 * clientId を指定した場合、そのクライアントが所有するシナリオのログのみに絞り込む
 * （client_owner が自テナント以外のログを処理できないようにするため）。
 * 省略した場合（system_admin 用）は全テナントを対象にする。
 */
export async function listPendingDueLogs(
  force: boolean,
  clientId?: string,
): Promise<PendingLogWithStep[]> {
  const supabase = createAdminClient();

  let allowedScenarioIds: Set<string> | null = null;
  if (clientId) {
    const { data: scenarios } = await supabase
      .from("follow_scenarios")
      .select("id")
      .eq("client_id", clientId);
    allowedScenarioIds = new Set(
      (scenarios ?? []).map((s) => (s as Record<string, unknown>).id as string),
    );
    if (allowedScenarioIds.size === 0) return [];
  }

  const { data: logs, error } = await supabase
    .from("scenario_logs")
    .select("id, scenario_id, step_id, customer_id, white_label_id, created_at")
    .eq("status", "pending");

  if (error || !logs?.length) return [];

  const stepIds = (logs as Record<string, unknown>[]).map(
    (l) => l.step_id as string,
  );

  const { data: steps } = await supabase
    .from("scenario_steps")
    .select("id, delay_days, subject, body, channel")
    .in("id", stepIds);

  const stepMap = new Map<string, Record<string, unknown>>();
  for (const s of (steps ?? []) as Record<string, unknown>[]) {
    stepMap.set(s.id as string, s);
  }

  const now = Date.now();
  const result: PendingLogWithStep[] = [];

  for (const log of logs as Record<string, unknown>[]) {
    if (allowedScenarioIds && !allowedScenarioIds.has(log.scenario_id as string)) {
      continue;
    }

    const step = stepMap.get(log.step_id as string);
    if (!step) continue;

    const delayDays = (step.delay_days as number) ?? 0;
    const sendAt =
      new Date(log.created_at as string).getTime() +
      delayDays * 86400 * 1000;

    if (!force && sendAt > now) continue;

    result.push({
      logId: log.id as string,
      scenarioId: log.scenario_id as string,
      stepId: log.step_id as string,
      customerId: log.customer_id as string,
      whiteLabelId: log.white_label_id as string,
      delayDays,
      createdAt: log.created_at as string,
      subject: (step.subject as string) ?? null,
      body: step.body as string,
      channel: (step.channel as string) ?? "email",
    });
  }

  return result;
}

export async function markLogSent(logId: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("scenario_logs")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", logId);
}

export async function markLogFailed(
  logId: string,
  errorMessage: string,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("scenario_logs")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", logId);
}

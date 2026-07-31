import { createClient } from "@/lib/supabase/server";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface ScenarioRow {
  id: string;
  whiteLabelId: string;
  clientId: string;
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  status: string;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  stepCount?: number;
}

export interface StepRow {
  id: string;
  whiteLabelId: string;
  scenarioId: string;
  stepNumber: number;
  delayDays: number;
  channel: string;
  subject: string | null;
  body: string;
  aiGenerated: boolean;
  createdAt: string;
}

export interface CreateScenarioInput {
  name: string;
  triggerType: string;
  status: string;
  clientId: string;
  whiteLabelId: string;
}

export interface UpdateScenarioInput {
  name?: string;
  triggerType?: string;
  status?: string;
}

export interface CreateStepInput {
  scenarioId: string;
  whiteLabelId: string;
  delayDays: number;
  channel?: string;
  subject?: string;
  body: string;
}

export interface UpdateStepInput {
  delayDays?: number;
  channel?: string;
  subject?: string;
  body?: string;
}

const SCENARIO_COLS =
  "id, white_label_id, client_id, name, trigger_type, trigger_config, status, ai_generated, created_at, updated_at";

const STEP_COLS =
  "id, white_label_id, scenario_id, step_number, delay_days, channel, subject, body, ai_generated, created_at";

function mapScenario(r: Record<string, unknown>): ScenarioRow {
  return {
    id: r.id as string,
    whiteLabelId: r.white_label_id as string,
    clientId: r.client_id as string,
    name: r.name as string,
    triggerType: (r.trigger_type as string) ?? "manual",
    triggerConfig: (r.trigger_config as Record<string, unknown>) ?? {},
    status: r.status as string,
    aiGenerated: (r.ai_generated as boolean) ?? false,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    stepCount: typeof r.step_count === "number" ? r.step_count : undefined,
  };
}

function mapStep(r: Record<string, unknown>): StepRow {
  return {
    id: r.id as string,
    whiteLabelId: r.white_label_id as string,
    scenarioId: r.scenario_id as string,
    stepNumber: r.step_number as number,
    delayDays: (r.delay_days as number) ?? 0,
    channel: (r.channel as string) ?? "email",
    subject: (r.subject as string) ?? null,
    body: r.body as string,
    aiGenerated: (r.ai_generated as boolean) ?? false,
    createdAt: r.created_at as string,
  };
}

/** シナリオ一覧（ステップ数付き） */
export async function listScenarios(): Promise<ScenarioRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("follow_scenarios")
    .select(`${SCENARIO_COLS}, scenario_steps(count)`)
    .order("created_at", { ascending: false });

  if (error)
    throwSafe("シナリオ一覧の取得に失敗しました", error);

  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const steps = row.scenario_steps as Array<{ count: number }> | undefined;
    return mapScenario({ ...row, step_count: steps?.[0]?.count ?? 0 });
  });
}

/** シナリオ1件取得 */
export async function getScenario(id: string): Promise<ScenarioRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("follow_scenarios")
    .select(SCENARIO_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error)
    throwSafe("シナリオの取得に失敗しました", error);
  if (!data) return null;
  return mapScenario(data as Record<string, unknown>);
}

/** シナリオ作成 */
export async function createScenario(
  input: CreateScenarioInput,
): Promise<ScenarioRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("follow_scenarios")
    .insert({
      name: input.name,
      trigger_type: input.triggerType,
      status: input.status,
      client_id: input.clientId,
      white_label_id: input.whiteLabelId,
    })
    .select(SCENARIO_COLS)
    .single();

  if (error || !data)
    throwSafe("シナリオの作成に失敗しました", error);
  return mapScenario(data as Record<string, unknown>);
}

/** シナリオ更新 */
export async function updateScenario(
  id: string,
  input: UpdateScenarioInput,
): Promise<ScenarioRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("follow_scenarios")
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.triggerType !== undefined && {
        trigger_type: input.triggerType,
      }),
      ...(input.status !== undefined && { status: input.status }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(SCENARIO_COLS)
    .single();

  if (error || !data)
    throwSafe("シナリオの更新に失敗しました", error);
  return mapScenario(data as Record<string, unknown>);
}

/** シナリオ削除（ステップは CASCADE） */
export async function deleteScenario(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("follow_scenarios")
    .delete()
    .eq("id", id);
  if (error)
    throwSafe("シナリオの削除に失敗しました", error);
}

/** ステップ一覧（step_number 昇順） */
export async function listSteps(scenarioId: string): Promise<StepRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("scenario_steps")
    .select(STEP_COLS)
    .eq("scenario_id", scenarioId)
    .order("step_number", { ascending: true });

  if (error)
    throwSafe("ステップ一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => mapStep(r as Record<string, unknown>));
}

/** ステップ追加（step_number は現在の最大値 + 1） */
export async function addStep(input: CreateStepInput): Promise<StepRow> {
  const supabase = createClient();

  const { data: maxData } = await supabase
    .from("scenario_steps")
    .select("step_number")
    .eq("scenario_id", input.scenarioId)
    .order("step_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNumber =
    ((maxData as Record<string, unknown> | null)?.step_number as number ?? 0) + 1;

  const { data, error } = await supabase
    .from("scenario_steps")
    .insert({
      scenario_id: input.scenarioId,
      white_label_id: input.whiteLabelId,
      step_number: nextNumber,
      delay_days: input.delayDays,
      channel: input.channel ?? "email",
      subject: input.subject ?? null,
      body: input.body,
    })
    .select(STEP_COLS)
    .single();

  if (error || !data)
    throwSafe("ステップの追加に失敗しました", error);
  return mapStep(data as Record<string, unknown>);
}

/** ステップ更新 */
export async function updateStep(
  id: string,
  input: UpdateStepInput,
): Promise<StepRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("scenario_steps")
    .update({
      ...(input.delayDays !== undefined && { delay_days: input.delayDays }),
      ...(input.channel !== undefined && { channel: input.channel }),
      ...(input.subject !== undefined && { subject: input.subject }),
      ...(input.body !== undefined && { body: input.body }),
    })
    .eq("id", id)
    .select(STEP_COLS)
    .single();

  if (error || !data)
    throwSafe("ステップの更新に失敗しました", error);
  return mapStep(data as Record<string, unknown>);
}

/** ステップ削除 */
export async function deleteStep(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("scenario_steps")
    .delete()
    .eq("id", id);
  if (error)
    throwSafe("ステップの削除に失敗しました", error);
}

export interface CustomerScenarioLog {
  logId: string;
  scenarioId: string;
  scenarioName: string;
  stepId: string;
  stepNumber: number;
  subject: string | null;
  status: string; // "pending" | "sent" | "failed"
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/**
 * 顧客のシナリオ配信ログ一覧を取得する（新しい順）。
 * RLS で自テナントのみ。
 */
export async function getCustomerScenarioLogs(
  customerId: string,
  limit = 30,
): Promise<CustomerScenarioLog[]> {
  const supabase = createClient();

  const { data: logs, error } = await supabase
    .from("scenario_logs")
    .select("id, scenario_id, step_id, status, sent_at, error_message, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !logs?.length) return [];

  const typedLogs = logs as Record<string, unknown>[];
  const scenarioIds = [...new Set(typedLogs.map((l) => l.scenario_id as string))];
  const stepIds = [...new Set(typedLogs.map((l) => l.step_id as string))];

  const [{ data: scenarios }, { data: steps }] = await Promise.all([
    supabase
      .from("follow_scenarios")
      .select("id, name")
      .in("id", scenarioIds),
    supabase
      .from("scenario_steps")
      .select("id, step_number, subject, delay_days")
      .in("id", stepIds),
  ]);

  const scenarioMap = new Map<string, string>();
  for (const s of (scenarios ?? []) as Record<string, unknown>[]) {
    scenarioMap.set(s.id as string, s.name as string);
  }

  const stepMap = new Map<string, Record<string, unknown>>();
  for (const s of (steps ?? []) as Record<string, unknown>[]) {
    stepMap.set(s.id as string, s);
  }

  return typedLogs.map((log) => {
    const step = stepMap.get(log.step_id as string);
    const delayDays = (step?.delay_days as number) ?? 0;
    const scheduledAt = new Date(
      new Date(log.created_at as string).getTime() + delayDays * 86400 * 1000,
    ).toISOString();

    return {
      logId: log.id as string,
      scenarioId: log.scenario_id as string,
      scenarioName: scenarioMap.get(log.scenario_id as string) ?? "不明",
      stepId: log.step_id as string,
      stepNumber: (step?.step_number as number) ?? 0,
      subject: (step?.subject as string) ?? null,
      status: log.status as string,
      scheduledAt,
      sentAt: (log.sent_at as string) ?? null,
      errorMessage: (log.error_message as string) ?? null,
      createdAt: log.created_at as string,
    };
  });
}

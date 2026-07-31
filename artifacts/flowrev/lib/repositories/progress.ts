import { createAdminClient } from "@/lib/supabase/admin";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface ProgressRow {
  id: string;
  customerId: string;
  lessonId: string;
  courseId: string;
  completed: boolean;
  completedAt: string | null;
  watchSeconds: number;
}

function mapProgress(r: Record<string, unknown>): ProgressRow {
  return {
    id: r.id as string,
    customerId: r.customer_id as string,
    lessonId: r.lesson_id as string,
    courseId: r.course_id as string,
    completed: r.completed as boolean,
    completedAt: (r.completed_at as string) ?? null,
    watchSeconds: (r.watch_seconds as number) ?? 0,
  };
}

/**
 * 顧客の auth uid から customers.id を取得する。
 * customers テーブルに user_id カラムがあることを前提とする。
 */
export async function getCustomerIdByUserId(
  userId: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  if (!data) return null;
  return (data as Record<string, unknown>).id as string;
}

/** コース内の全レッスンの進捗を取得する */
export async function getCourseProgress(
  customerId: string,
  courseId: string,
): Promise<ProgressRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lesson_progress")
    .select("*")
    .eq("customer_id", customerId)
    .eq("course_id", courseId);

  if (error) throwSafe("進捗の取得に失敗しました", error);
  return (data ?? []).map((r) => mapProgress(r as Record<string, unknown>));
}

/** 全コースの完了済みレッスン数を集計する */
export async function getCompletedCountsByCourse(
  customerId: string,
): Promise<Map<string, number>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lesson_progress")
    .select("course_id")
    .eq("customer_id", customerId)
    .eq("completed", true);

  if (error) return new Map();
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const cid = r.course_id as string;
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  return counts;
}

/** レッスン進捗を完了状態で UPSERT する */
export async function upsertLessonComplete(
  customerId: string,
  lessonId: string,
  courseId: string,
  whiteLabelId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("lesson_progress").upsert(
    {
      customer_id: customerId,
      lesson_id: lessonId,
      course_id: courseId,
      white_label_id: whiteLabelId,
      completed: true,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "customer_id,lesson_id" },
  );

  if (error)
    throwSafe("進捗の更新に失敗しました", error);
}

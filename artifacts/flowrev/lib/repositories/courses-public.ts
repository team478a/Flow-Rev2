/**
 * 顧客向けコース取得（管理クライアント使用）
 * RLS ポリシーが customer 未対応のため、admin client で clientId でフィルタする。
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { CourseRow, LessonRow } from "@/lib/repositories/courses";
import { throwSafe } from "@/lib/repositories/error-utils";

function mapCourse(r: Record<string, unknown>): CourseRow {
  return {
    id: r.id as string,
    whiteLabelId: r.white_label_id as string,
    clientId: r.client_id as string,
    productId: (r.product_id as string) ?? null,
    title: r.title as string,
    description: (r.description as string) ?? null,
    thumbnailUrl: (r.thumbnail_url as string) ?? null,
    status: r.status as string,
    sortOrder: (r.sort_order as number) ?? 0,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    lessonCount: typeof r.lesson_count === "number" ? r.lesson_count : undefined,
  };
}

function mapLesson(r: Record<string, unknown>): LessonRow {
  return {
    id: r.id as string,
    whiteLabelId: r.white_label_id as string,
    clientId: r.client_id as string,
    courseId: r.course_id as string,
    title: r.title as string,
    contentType: (r.content_type as string) ?? "video",
    videoType: (r.video_type as string) ?? "url",
    videoUrl: (r.video_url as string) ?? null,
    cloudflareVideoId: (r.cloudflare_video_id as string) ?? null,
    cloudflareVideoStatus: (r.cloudflare_video_status as string) ?? null,
    textContent: (r.text_content as string) ?? null,
    fileUrl: (r.file_url as string) ?? null,
    durationSeconds: (r.duration_seconds as number) ?? null,
    sortOrder: (r.sort_order as number) ?? 0,
    status: r.status as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** 顧客が属する client の公開済みコース一覧（レッスン数付き） */
export async function listPublishedCourses(
  clientId: string,
): Promise<CourseRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("courses")
    .select("*, lessons(count)")
    .eq("client_id", clientId)
    .eq("status", "published")
    .order("sort_order", { ascending: true });

  if (error) throwSafe("コース一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const ls = row.lessons as Array<{ count: number }> | undefined;
    return mapCourse({ ...row, lesson_count: ls?.[0]?.count ?? 0 });
  });
}

/** 公開済みコース1件取得 */
export async function getPublishedCourse(
  courseId: string,
  clientId: string,
): Promise<CourseRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .eq("client_id", clientId)
    .eq("status", "published")
    .maybeSingle();

  if (error) throwSafe("コースの取得に失敗しました", error);
  if (!data) return null;
  return mapCourse(data as Record<string, unknown>);
}

/** 公開済みレッスン一覧（sort_order 昇順） */
export async function listPublishedLessons(
  courseId: string,
): Promise<LessonRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lessons")
    .select("*")
    .eq("course_id", courseId)
    .eq("status", "published")
    .order("sort_order", { ascending: true });

  if (error) throwSafe("レッスン一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => mapLesson(r as Record<string, unknown>));
}

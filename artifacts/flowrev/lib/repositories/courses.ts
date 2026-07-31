import { createClient } from "@/lib/supabase/server";
import { throwSafe } from "@/lib/repositories/error-utils";

export interface CourseRow {
  id: string;
  whiteLabelId: string;
  clientId: string;
  productId: string | null;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  lessonCount?: number;
}

export interface LessonRow {
  id: string;
  whiteLabelId: string;
  clientId: string;
  courseId: string;
  title: string;
  contentType: string;
  videoType: string;
  videoUrl: string | null;
  cloudflareVideoId: string | null;
  cloudflareVideoStatus: string | null;
  textContent: string | null;
  fileUrl: string | null;
  durationSeconds: number | null;
  sortOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCourseInput {
  whiteLabelId: string;
  clientId: string;
  title: string;
  description?: string;
  status: string;
}

export interface UpdateCourseInput {
  title?: string;
  description?: string | null;
  status?: string;
}

export interface CreateLessonInput {
  whiteLabelId: string;
  clientId: string;
  courseId: string;
  title: string;
  contentType: string;
  videoType?: string;
  videoUrl?: string;
  cloudflareVideoId?: string;
  textContent?: string;
  fileUrl?: string;
  durationSeconds?: number;
  status: string;
}

export interface UpdateLessonInput {
  title?: string;
  contentType?: string;
  videoType?: string;
  videoUrl?: string | null;
  cloudflareVideoId?: string | null;
  textContent?: string | null;
  fileUrl?: string | null;
  durationSeconds?: number | null;
  status?: string;
}

const COURSE_COLS =
  "id, white_label_id, client_id, product_id, title, description, thumbnail_url, status, sort_order, created_at, updated_at";

const LESSON_COLS =
  "id, white_label_id, client_id, course_id, title, content_type, video_type, video_url, cloudflare_video_id, cloudflare_video_status, text_content, file_url, duration_seconds, sort_order, status, created_at, updated_at";

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

/** コース一覧（sort_order 昇順、レッスン数付き） */
export async function listCourses(): Promise<CourseRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("courses")
    .select(`${COURSE_COLS}, lessons(count)`)
    .order("sort_order", { ascending: true });

  if (error) throwSafe("コース一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const ls = row.lessons as Array<{ count: number }> | undefined;
    return mapCourse({ ...row, lesson_count: ls?.[0]?.count ?? 0 });
  });
}

/** コース1件取得 */
export async function getCourse(id: string): Promise<CourseRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("courses")
    .select(COURSE_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) throwSafe("コースの取得に失敗しました", error);
  if (!data) return null;
  return mapCourse(data as Record<string, unknown>);
}

/** コース作成 */
export async function createCourse(
  input: CreateCourseInput,
): Promise<CourseRow> {
  const supabase = createClient();
  const { data: maxData } = await supabase
    .from("courses")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as Record<string, unknown> | null)?.sort_order as number ?? -1) + 1;

  const { data, error } = await supabase
    .from("courses")
    .insert({
      white_label_id: input.whiteLabelId,
      client_id: input.clientId,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      sort_order: nextOrder,
    })
    .select(COURSE_COLS)
    .single();

  if (error || !data)
    throwSafe("コースの作成に失敗しました", error);
  return mapCourse(data as Record<string, unknown>);
}

/** コース更新 */
export async function updateCourse(
  id: string,
  input: UpdateCourseInput,
): Promise<CourseRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("courses")
    .update({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status !== undefined && { status: input.status }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(COURSE_COLS)
    .single();

  if (error || !data)
    throwSafe("コースの更新に失敗しました", error);
  return mapCourse(data as Record<string, unknown>);
}

/** コース削除（レッスンは CASCADE） */
export async function deleteCourse(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) throwSafe("コースの削除に失敗しました", error);
}

/** レッスン一覧（sort_order 昇順） */
export async function listLessons(courseId: string): Promise<LessonRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("lessons")
    .select(LESSON_COLS)
    .eq("course_id", courseId)
    .order("sort_order", { ascending: true });

  if (error) throwSafe("レッスン一覧の取得に失敗しました", error);
  return (data ?? []).map((r) => mapLesson(r as Record<string, unknown>));
}

/** レッスン追加（sort_order は max + 1） */
export async function addLesson(input: CreateLessonInput): Promise<LessonRow> {
  const supabase = createClient();
  const { data: maxData } = await supabase
    .from("lessons")
    .select("sort_order")
    .eq("course_id", input.courseId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as Record<string, unknown> | null)?.sort_order as number ?? -1) + 1;

  const { data, error } = await supabase
    .from("lessons")
    .insert({
      white_label_id: input.whiteLabelId,
      client_id: input.clientId,
      course_id: input.courseId,
      title: input.title,
      content_type: input.contentType,
      video_type: input.videoType ?? "url",
      video_url: input.videoUrl ?? null,
      cloudflare_video_id: input.cloudflareVideoId ?? null,
      // Cloudflare 動画が指定された場合はトランスコード待ち状態で作成する
      cloudflare_video_status: input.cloudflareVideoId ? "pending" : null,
      text_content: input.textContent ?? null,
      file_url: input.fileUrl ?? null,
      duration_seconds: input.durationSeconds ?? null,
      sort_order: nextOrder,
      status: input.status,
    })
    .select(LESSON_COLS)
    .single();

  if (error || !data)
    throwSafe("レッスンの追加に失敗しました", error);
  return mapLesson(data as Record<string, unknown>);
}

/** レッスン更新 */
export async function updateLesson(
  id: string,
  input: UpdateLessonInput,
): Promise<LessonRow> {
  const supabase = createClient();

  // cloudflareVideoId が変更された場合は status を pending にリセットする
  // null への変更（動画削除）は status も null にリセット
  const cfStatusPatch: Record<string, unknown> = {};
  if (input.cloudflareVideoId !== undefined) {
    cfStatusPatch.cloudflare_video_status = input.cloudflareVideoId
      ? "pending"
      : null;
  }

  const { data, error } = await supabase
    .from("lessons")
    .update({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.contentType !== undefined && { content_type: input.contentType }),
      ...(input.videoType !== undefined && { video_type: input.videoType }),
      ...(input.videoUrl !== undefined && { video_url: input.videoUrl }),
      ...(input.cloudflareVideoId !== undefined && { cloudflare_video_id: input.cloudflareVideoId }),
      ...cfStatusPatch,
      ...(input.textContent !== undefined && { text_content: input.textContent }),
      ...(input.fileUrl !== undefined && { file_url: input.fileUrl }),
      ...(input.durationSeconds !== undefined && {
        duration_seconds: input.durationSeconds,
      }),
      ...(input.status !== undefined && { status: input.status }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(LESSON_COLS)
    .single();

  if (error || !data)
    throwSafe("レッスンの更新に失敗しました", error);
  return mapLesson(data as Record<string, unknown>);
}

/** レッスン削除 */
export async function deleteLesson(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("lessons").delete().eq("id", id);
  if (error) throwSafe("レッスンの削除に失敗しました", error);
}

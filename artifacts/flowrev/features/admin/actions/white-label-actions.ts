"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/features/auth/session";
import {
  createWhiteLabel,
  updateWhiteLabel,
  deleteWhiteLabel,
  toggleWhiteLabelStatus,
} from "@/lib/repositories/white-labels";

const createSchema = z.object({
  brandName: z.string().trim().min(1, "ブランド名を入力してください。"),
  ownerEmail: z
    .string()
    .trim()
    .email("有効なメールアドレスを入力してください。"),
  ownerPassword: z
    .string()
    .min(8, "パスワードは8文字以上で入力してください。"),
  ownerDisplayName: z.string().trim().optional(),
  planId: z.string().uuid().optional(),
  brandColor: z.string().trim().optional(),
});

export interface CreateWhiteLabelState {
  error: string | null;
}

/**
 * ホワイトラベル作成サーバーアクション。
 * 管理者クライアントは RLS をバイパスするため、冒頭で system_admin を再検証する。
 */
export async function createWhiteLabelAction(
  _prevState: CreateWhiteLabelState,
  formData: FormData,
): Promise<CreateWhiteLabelState> {
  const session = await getSessionProfile();
  if (session?.role !== "system_admin") {
    return { error: "この操作を行う権限がありません。" };
  }

  const planIdRaw = String(formData.get("planId") ?? "").trim();
  const displayNameRaw = String(formData.get("ownerDisplayName") ?? "").trim();
  const brandColorRaw = String(formData.get("brandColor") ?? "").trim();

  const parsed = createSchema.safeParse({
    brandName: formData.get("brandName"),
    ownerEmail: formData.get("ownerEmail"),
    ownerPassword: formData.get("ownerPassword"),
    ownerDisplayName: displayNameRaw || undefined,
    planId: planIdRaw || undefined,
    brandColor: brandColorRaw || undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }

  try {
    await createWhiteLabel(parsed.data);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "作成に失敗しました。",
    };
  }

  revalidatePath("/admin/white-labels");
  redirect("/admin/white-labels");
}

/** 空文字は「未設定」として null に落とす。URL項目は形式も検証する。 */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine(
    (v) => v == null || /^https?:\/\//.test(v),
    "URLは http:// または https:// で始めてください。",
  );

const updateSchema = z.object({
  brandName: z.string().trim().min(1, "ブランド名を入力してください。"),
  brandColor: z.string().trim().optional(),
  planId: z.string().uuid().optional(),
  status: z.enum(["active", "suspended"]),
  brandLogoUrl: optionalUrl,
  brandFaviconUrl: optionalUrl,
  brandDomain: optionalText,
  senderName: optionalText,
  supportEmail: optionalText,
  companyName: optionalText,
  termsUrl: optionalUrl,
  privacyUrl: optionalUrl,
});

export interface UpdateWhiteLabelState {
  error: string | null;
  success: boolean;
}

/**
 * ホワイトラベルを更新するサーバーアクション（system_admin のみ）。
 */
export async function updateWhiteLabelAction(
  id: string,
  _prevState: UpdateWhiteLabelState,
  formData: FormData,
): Promise<UpdateWhiteLabelState> {
  const session = await getSessionProfile();
  if (session?.role !== "system_admin") {
    return { error: "この操作を行う権限がありません。", success: false };
  }

  const planIdRaw = String(formData.get("planId") ?? "").trim();
  const parsed = updateSchema.safeParse({
    brandName: formData.get("brandName"),
    brandColor: String(formData.get("brandColor") ?? "").trim() || undefined,
    planId: planIdRaw || undefined,
    status: formData.get("status"),
    brandLogoUrl: formData.get("brandLogoUrl") ?? "",
    brandFaviconUrl: formData.get("brandFaviconUrl") ?? "",
    brandDomain: formData.get("brandDomain") ?? "",
    senderName: formData.get("senderName") ?? "",
    supportEmail: formData.get("supportEmail") ?? "",
    companyName: formData.get("companyName") ?? "",
    termsUrl: formData.get("termsUrl") ?? "",
    privacyUrl: formData.get("privacyUrl") ?? "",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
      success: false,
    };
  }

  try {
    await updateWhiteLabel(id, {
      brandName: parsed.data.brandName,
      brandColor: parsed.data.brandColor,
      planId: parsed.data.planId ?? null,
      status: parsed.data.status,
      brandLogoUrl: parsed.data.brandLogoUrl ?? null,
      brandFaviconUrl: parsed.data.brandFaviconUrl ?? null,
      brandDomain: parsed.data.brandDomain ?? null,
      senderName: parsed.data.senderName ?? null,
      supportEmail: parsed.data.supportEmail ?? null,
      companyName: parsed.data.companyName ?? null,
      termsUrl: parsed.data.termsUrl ?? null,
      privacyUrl: parsed.data.privacyUrl ?? null,
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "更新に失敗しました。",
      success: false,
    };
  }

  revalidatePath("/admin/white-labels");
  redirect("/admin/white-labels");
}

export interface DeleteWhiteLabelState {
  error: string | null;
}

/**
 * ホワイトラベルを削除するサーバーアクション（system_admin のみ）。
 */
export async function deleteWhiteLabelAction(
  id: string,
): Promise<DeleteWhiteLabelState> {
  const session = await getSessionProfile();
  if (session?.role !== "system_admin") {
    return { error: "この操作を行う権限がありません。" };
  }

  try {
    await deleteWhiteLabel(id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "削除に失敗しました。" };
  }

  revalidatePath("/admin/white-labels");
  return { error: null };
}

export interface ToggleWLStatusState {
  error: string | null;
}

/**
 * ホワイトラベルのステータスを切り替えるサーバーアクション（system_admin のみ）。
 */
export async function toggleWhiteLabelStatusAction(
  _prevState: ToggleWLStatusState,
  formData: FormData,
): Promise<ToggleWLStatusState> {
  const session = await getSessionProfile();
  if (session?.role !== "system_admin") {
    return { error: "この操作を行う権限がありません。" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as
    | "active"
    | "suspended";
  if (!id || !["active", "suspended"].includes(status)) {
    return { error: "パラメータが不正です。" };
  }

  try {
    await toggleWhiteLabelStatus(id, status);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "変更に失敗しました。" };
  }

  revalidatePath("/admin/white-labels");
  return { error: null };
}

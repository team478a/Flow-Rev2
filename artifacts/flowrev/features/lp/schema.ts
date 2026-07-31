import { z } from "zod";

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "カラー値の形式が不正です。")
  .optional()
  .or(z.literal(""));

export const lpSchema = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください。"),
  slug: z
    .string()
    .trim()
    .min(1, "スラッグを入力してください。")
    .regex(
      /^[a-z0-9-]+$/,
      "スラッグは半角英数字とハイフンのみ使用できます。",
    ),
  productId: z.string().uuid().optional().or(z.literal("")),
  htmlContent: z.string().trim().optional(),
  status: z.enum(["draft", "published", "archived"], {
    errorMap: () => ({ message: "ステータスを選択してください。" }),
  }),
  // AIデザインウィザードで生成した場合のみ設定される（docs/audit/05_SECURITY_FINDINGS.md L-2）。
  // HTML詳細編集フォームからは送られないため、その場合はすべて未設定のままになる。
  designStyleName: z.string().trim().max(50).optional().or(z.literal("")),
  colorPrimary: hexColorSchema,
  colorBg: hexColorSchema,
  colorAccent: hexColorSchema,
});

export type LpFormValues = z.infer<typeof lpSchema>;

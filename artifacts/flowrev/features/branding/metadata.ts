import "server-only";
import type { Metadata } from "next";
import { getWhiteLabelBranding } from "@/lib/repositories/white-labels";

/**
 * テナントのブランドを反映した metadata を組み立てる。
 *
 * ルートの `app/layout.tsx` は静的な metadata しか持てず、
 * どのテナントのリクエストかを知らない。テナントが確定するのは
 * セッションを読むレイアウト（/my・/dashboard・/wl）なので、
 * ファビコンとタイトルはそちらで generateMetadata から設定する。
 *
 * ブランド未設定・取得失敗時は本部の既定（FlowRev）に落とす。
 * ブランド表示のためにページを落とすのは割に合わない。
 */
export async function buildBrandMetadata(
  whiteLabelId: string | null,
  fallbackTitle: string,
): Promise<Metadata> {
  if (!whiteLabelId) return { title: fallbackTitle };

  const branding = await getWhiteLabelBranding(whiteLabelId).catch(() => null);
  if (!branding) return { title: fallbackTitle };

  const metadata: Metadata = {
    title: branding.brandName || fallbackTitle,
  };

  if (branding.brandFaviconUrl) {
    metadata.icons = { icon: branding.brandFaviconUrl };
  }

  return metadata;
}

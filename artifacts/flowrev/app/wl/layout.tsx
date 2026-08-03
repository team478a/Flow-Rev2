import { AppShell } from "@/features/dashboard/components/app-shell";
import { requireWhiteLabelOwner } from "@/features/wl/guard";
import { getWhiteLabelBranding } from "@/lib/repositories/white-labels";
import { buildBrandMetadata } from "@/features/branding/metadata";
import { getSessionProfile } from "@/features/auth/session";
import type { NavItem } from "@/features/dashboard/components/sidebar-nav";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const session = await getSessionProfile();
  return buildBrandMetadata(session?.whiteLabelId ?? null, "FlowRev WL");
}

const NAV_ITEMS: NavItem[] = [
  { label: "ダッシュボード", href: "/wl/dashboard", icon: "⊞" },
  { label: "クライアント管理", href: "/wl/clients", icon: "🏢" },
  { label: "プラン管理", href: "/wl/plans", icon: "📋" },
  { label: "AI 共通設定", href: "/wl/settings/ai", icon: "🤖" },
  { label: "メール共通設定", href: "/wl/settings/email", icon: "✉️" },
  { label: "認証メール文面", href: "/wl/settings/auth-emails", icon: "📝" },
  { label: "LINE 共通設定", href: "/wl/settings/line", icon: "💬" },
  { label: "Stripe 共通設定", href: "/wl/settings/stripe", icon: "💳" },
  { label: "Cloudflare 共通設定", href: "/wl/settings/cloudflare", icon: "🎬" },
];

export default async function WlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireWhiteLabelOwner();

  // 自OEMのブランド設定を反映する。未設定なら本部の既定表示にフォールバックする。
  const branding = session.whiteLabelId
    ? await getWhiteLabelBranding(session.whiteLabelId).catch(() => null)
    : null;

  return (
    <AppShell
      brand={branding?.brandName ?? "FlowRev WL"}
      items={NAV_ITEMS}
      userName={session.displayName}
      userEmail={session.email}
      brandLogoUrl={branding?.brandLogoUrl ?? null}
      brandColor={branding?.brandColor ?? null}
    >
      {children}
    </AppShell>
  );
}

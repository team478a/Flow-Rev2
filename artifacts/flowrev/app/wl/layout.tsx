import { AppShell } from "@/features/dashboard/components/app-shell";
import { requireWhiteLabelOwner } from "@/features/wl/guard";
import type { NavItem } from "@/features/dashboard/components/sidebar-nav";

export const dynamic = "force-dynamic";

const NAV_ITEMS: NavItem[] = [
  { label: "ダッシュボード", href: "/wl/dashboard", icon: "⊞" },
  { label: "クライアント管理", href: "/wl/clients", icon: "🏢" },
  { label: "プラン管理", href: "/wl/plans", icon: "📋" },
  { label: "LINE 共通設定", href: "/wl/settings/line", icon: "💬" },
  { label: "Stripe 共通設定", href: "/wl/settings/stripe", icon: "💳" },
];

export default async function WlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireWhiteLabelOwner();

  return (
    <AppShell
      brand="FlowRev WL"
      items={NAV_ITEMS}
      userName={session.displayName}
      userEmail={session.email}
    >
      {children}
    </AppShell>
  );
}

import Link from "next/link";
import { getSessionProfile } from "@/features/auth/session";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getWhiteLabelBranding } from "@/lib/repositories/white-labels";
import { BrandFooter } from "@/features/branding/brand-footer";
import { buildBrandMetadata } from "@/features/branding/metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const session = await getSessionProfile();
  return buildBrandMetadata(session?.whiteLabelId ?? null, "マイページ | FlowRev");
}

export default async function MyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.role !== "customer") redirect("/dashboard");

  // 顧客には、所属OEMのブランドが見える。未設定なら本部の既定表示になる。
  const branding = session.whiteLabelId
    ? await getWhiteLabelBranding(session.whiteLabelId).catch(() => null)
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between gap-4">
        <Link
          href="/my"
          className="flex items-center gap-2 font-semibold text-lg tracking-tight shrink-0"
          style={branding?.brandColor ? { color: branding.brandColor } : undefined}
        >
          {branding?.brandLogoUrl && (
            // 外部URLを許容するため next/image ではなく img を使う
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.brandLogoUrl}
              alt={branding.brandName}
              className="h-7 w-7 shrink-0 rounded object-contain"
            />
          )}
          {branding?.brandName ?? "マイページ"}
        </Link>
        <nav className="flex items-center gap-3 text-sm ml-auto">
          <Link
            href="/my"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            コース一覧
          </Link>
          <Link
            href="/my/settings"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            設定
          </Link>
          <span className="hidden sm:inline text-muted-foreground text-xs border-l pl-3">
            {session.displayName ?? session.email}
          </span>
          <LogoutButton />
        </nav>
      </header>
      <main className="w-full max-w-5xl mx-auto px-4 py-8">{children}</main>
      <BrandFooter branding={branding} />
    </div>
  );
}

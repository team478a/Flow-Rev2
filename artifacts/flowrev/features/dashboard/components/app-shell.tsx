"use client";

import { useState } from "react";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { logout } from "@/features/auth/actions";

interface AppShellProps {
  brand: string;
  items: NavItem[];
  userName: string | null;
  userEmail: string | null;
  /** OEMのロゴ画像URL。未指定なら既定のアイコンを表示する。 */
  brandLogoUrl?: string | null;
  /** OEMのブランドカラー。未指定なら既定色を使う。 */
  brandColor?: string | null;
  children: React.ReactNode;
}

export function AppShell({
  brand,
  items,
  userName,
  userEmail,
  brandLogoUrl = null,
  brandColor = null,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* サイドバー（デスクトップ） */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <SidebarNav
          brand={brand}
          items={items}
          userName={userName}
          userEmail={userEmail}
          brandLogoUrl={brandLogoUrl}
          brandColor={brandColor}
        />
        <div className="px-4 pb-4">
          <form action={logout} className="w-full">
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              ログアウト
            </button>
          </form>
        </div>
      </aside>

      {/* モバイル：ハンバーガー＋ドロワー */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <SidebarNav
          brand={brand}
          items={items}
          userName={userName}
          userEmail={userEmail}
          brandLogoUrl={brandLogoUrl}
          brandColor={brandColor}
        />
        <div className="px-4 pb-4">
          <form action={logout} className="w-full">
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              ログアウト
            </button>
          </form>
        </div>
      </aside>

      {/* メインエリア */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* モバイルヘッダー */}
        <header className="flex h-14 items-center border-b border-slate-200 bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mr-3 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="メニューを開く"
          >
            <span className="block h-0.5 w-5 bg-current mb-1" />
            <span className="block h-0.5 w-5 bg-current mb-1" />
            <span className="block h-0.5 w-5 bg-current" />
          </button>
          <span className="text-sm font-bold text-emerald-600">{brand}</span>
        </header>

        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}

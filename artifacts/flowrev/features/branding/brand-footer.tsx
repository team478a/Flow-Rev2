import type { WhiteLabelBranding } from "@/lib/repositories/white-labels";

interface BrandFooterProps {
  branding: WhiteLabelBranding | null;
}

/**
 * 顧客・クライアントに見えるフッター。
 *
 * OEMが設定した運営会社名・問い合わせ先・規約URLを表示する。
 * 未設定の項目は省略し、すべて未設定ならフッター自体を描画しない
 * （空の枠だけが残るのを避けるため）。
 *
 * 規約URLは外部サイトを指すため、next/link ではなく素の a を使う。
 */
export function BrandFooter({ branding }: BrandFooterProps) {
  if (!branding) return null;

  const { companyName, supportEmail, termsUrl, privacyUrl } = branding;
  if (!companyName && !supportEmail && !termsUrl && !privacyUrl) return null;

  const linkClass = "hover:text-foreground transition-colors";

  return (
    <footer className="mt-auto border-t bg-card px-4 py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-2 text-xs text-muted-foreground">
        {companyName && <p>{companyName}</p>}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className={linkClass}>
              お問い合わせ: {supportEmail}
            </a>
          )}
          {termsUrl && (
            <a
              href={termsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              利用規約
            </a>
          )}
          {privacyUrl && (
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              プライバシーポリシー
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}

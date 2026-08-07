/**
 * 認証メール（招待・パスワードリセット）のテンプレートと差し込み処理。
 *
 * テンプレート本文は管理画面で編集され、DBにOEM単位で保存される。
 * 未設定のOEMはここの既定テンプレートで送信されるため、
 * テーブルが空でも認証メールは届く。
 */

export const AUTH_TEMPLATE_KEYS = ["invite", "recovery"] as const;

/**
 * OEMが編集できる種別。
 *
 * `recovery` は含めない。パスワードリセットはログイン前の操作で、
 * どのOEMの利用者かを特定できないため本部の文面で送っている
 * （`requestPasswordReset` は whiteLabelId: null 固定）。
 * OEM画面に置くと、保存はできるのに一切反映されない欄になる。
 */
export const WL_EDITABLE_TEMPLATE_KEYS = ["invite"] as const;
export type AuthTemplateKey = (typeof AUTH_TEMPLATE_KEYS)[number];

export interface AuthEmailTemplate {
  subject: string;
  bodyHtml: string;
}

/** テンプレートに差し込める値。ここに無いキーは展開されない。 */
export interface AuthTemplateVars {
  /** 認証リンク（token_hash 付き） */
  link: string;
  /** ブランド名。OEM未設定なら FlowRev */
  brand: string;
  /** 宛先の表示名。不明な場合は空文字 */
  name: string;
}

export const AUTH_TEMPLATE_LABELS: Record<AuthTemplateKey, string> = {
  invite: "招待メール",
  recovery: "パスワードリセット",
};

export const AUTH_TEMPLATE_DESCRIPTIONS: Record<AuthTemplateKey, string> = {
  invite:
    "商品を購入した方・LPから登録した方へ、会員ページのアカウントを有効化してもらうために送られます。",
  recovery:
    "ログイン画面の「パスワードをお忘れですか？」から送られます。",
};

/**
 * 差し込み可能なプレースホルダ。管理画面の説明にも使う。
 * `{{link}}` が本文に無いテンプレートは保存時に拒否する（リンクの無い認証メールは無意味なため）。
 */
export const AUTH_TEMPLATE_PLACEHOLDERS: { token: string; description: string }[] =
  [
    { token: "{{link}}", description: "認証リンク（必須）" },
    { token: "{{brand}}", description: "ブランド名" },
    { token: "{{name}}", description: "宛先の表示名" },
  ];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // 属性をシングルクォートで囲んだテンプレートもありうるため両方エスケープする
    .replace(/'/g, "&#39;");
}

/**
 * テンプレートへ値を差し込む。
 *
 * 差し込む値は必ずエスケープする。`name` は登録フォーム由来で利用者が自由に
 * 入力でき、`brand` もOEMが入力するため、生のままHTMLへ入れてはいけない。
 * テンプレート本文そのものは管理画面で書かれたHTMLなのでエスケープしない。
 *
 * 未知のプレースホルダ（`{{foo}}`）はそのまま残す。消してしまうと、
 * 打ち間違いに気づけないまま空欄のメールが届くことになる。
 */
export function renderAuthTemplate(
  template: string,
  vars: AuthTemplateVars,
): string {
  return template
    .replace(/\{\{\s*link\s*\}\}/g, escapeHtml(vars.link))
    .replace(/\{\{\s*brand\s*\}\}/g, escapeHtml(vars.brand))
    .replace(/\{\{\s*name\s*\}\}/g, escapeHtml(vars.name));
}

/** 件名は素のテキストとして扱うため、エスケープせずそのまま差し込む。 */
export function renderAuthSubject(
  subject: string,
  vars: AuthTemplateVars,
): string {
  return subject
    .replace(/\{\{\s*brand\s*\}\}/g, vars.brand)
    .replace(/\{\{\s*name\s*\}\}/g, vars.name);
}

/**
 * HTMLメールに添えるテキスト版を組み立てる。
 * 本文HTMLはOEMが自由に書けるため機械的な変換は諦め、
 * 「リンクだけは確実に読める」ことを優先する。
 */
export function buildAuthTextBody(vars: AuthTemplateVars): string {
  return [
    ...(vars.name ? [`${vars.name} 様`, ""] : []),
    `${vars.brand} からのご案内です。`,
    "下記のURLを開いて手続きを完了してください。",
    "",
    vars.link,
    "",
    "※このメールに心当たりがない場合は破棄してください。",
  ].join("\n");
}

function layout(inner: string): string {
  return `<!doctype html>
<html lang="ja">
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr><td style="padding:28px 32px;">
${inner}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#a1a1aa;">心当たりがない場合はこのメールを破棄してください。</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(label: string): string {
  return `          <p style="margin:0 0 24px;">
            <a href="{{link}}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px;">${label}</a>
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;word-break:break-all;">
            ボタンが開けない場合は次のURLをブラウザに貼り付けてください：<br>{{link}}
          </p>`;
}

/**
 * 既定テンプレート。OEM・HQのいずれにも保存が無い場合に使われる。
 */
export const DEFAULT_AUTH_TEMPLATES: Record<AuthTemplateKey, AuthEmailTemplate> =
  {
    invite: {
      subject: "【{{brand}}】アカウント登録のご案内",
      bodyHtml: layout(
        `          <h1 style="margin:0 0 8px;font-size:18px;">{{brand}} へようこそ</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#3f3f46;">
            ご登録ありがとうございます。<br>
            下記のボタンからアカウントを有効化してください。
          </p>
${button("アカウントを有効化する")}`,
      ),
    },
    recovery: {
      subject: "【{{brand}}】パスワード再設定のご案内",
      bodyHtml: layout(
        `          <h1 style="margin:0 0 8px;font-size:18px;">パスワードを再設定</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#3f3f46;">
            パスワードのリセット依頼を受け付けました。<br>
            下記のボタンから新しいパスワードを設定してください。
          </p>
${button("パスワードを再設定する")}`,
      ),
    },
  };

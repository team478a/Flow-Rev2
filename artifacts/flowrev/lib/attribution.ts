/**
 * 流入元（アトリビューション）の受け取りと正規化。
 *
 * 値はすべて**公開ページのURLとブラウザ由来**で、送信者が自由に決められる。
 * そのまま保存すると次の問題が起きる。
 *   - 長大な文字列で行を膨らませられる
 *   - 一覧の集計軸（utm_source）が無限に増えて画面が壊れる
 *
 * 表示にはHTMLエスケープではなくReactのテキスト描画を使うため注入の心配は
 * 無いが、長さと件数は入口で切る。
 */

/** 1項目あたりの上限。広告のcampaign名でも十分入る長さ。 */
const MAX_LENGTH = 200;
/** リファラはURLなので少し長めに許容する。 */
const MAX_REFERRER_LENGTH = 500;

export interface Attribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
}

export const EMPTY_ATTRIBUTION: Attribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  referrer: null,
};

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  // 制御文字を落とす。ログや一覧の表示が崩れるのを防ぐ。
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * リクエストボディから流入元を取り出す。未知のキーは無視する。
 */
export function parseAttribution(input: unknown): Attribution {
  if (!input || typeof input !== "object") return EMPTY_ATTRIBUTION;
  const raw = input as Record<string, unknown>;

  return {
    utmSource: clean(raw.utmSource, MAX_LENGTH),
    utmMedium: clean(raw.utmMedium, MAX_LENGTH),
    utmCampaign: clean(raw.utmCampaign, MAX_LENGTH),
    utmTerm: clean(raw.utmTerm, MAX_LENGTH),
    utmContent: clean(raw.utmContent, MAX_LENGTH),
    referrer: clean(raw.referrer, MAX_REFERRER_LENGTH),
  };
}

/** DBの列名へ変換する。 */
export function attributionColumns(a: Attribution): Record<string, string | null> {
  return {
    utm_source: a.utmSource,
    utm_medium: a.utmMedium,
    utm_campaign: a.utmCampaign,
    utm_term: a.utmTerm,
    utm_content: a.utmContent,
    referrer: a.referrer,
  };
}

/**
 * 集計・表示に使う流入元のラベル。
 *
 * `utm_source` が無い登録も必ず数に含める。除外すると合計が登録数と合わず、
 * 「どこから来たか分からない分」が見えなくなって数字を信用できなくなる。
 */
export function attributionLabel(
  utmSource: string | null,
  referrer: string | null,
): string {
  if (utmSource) return utmSource;
  if (!referrer) return "直接アクセス";

  try {
    return new URL(referrer).hostname || "不明";
  } catch {
    return "不明";
  }
}

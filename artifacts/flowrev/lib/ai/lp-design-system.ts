/**
 * LP デザインシステム
 * CSS はサーバー側で生成し、AI はクラスを使ったHTML骨格のみ生成する。
 */

export interface LpColorConfig {
  primary: string;
  bg: string;
  accent: string;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** カラー文字列が安全なCSS16進カラー値かどうかを検証する（CSSインジェクション対策） */
export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

const STYLE_META: Record<string, { radius: string; darkBg: string; font: string }> = {
  モダン:    { radius: "8px",  darkBg: "#111827", font: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" },
  ナチュラル: { radius: "16px", darkBg: "#3d2b1f", font: "'Georgia','Hiragino Mincho Pro',serif" },
  高級感:    { radius: "4px",  darkBg: "#0f0f0f", font: "'Palatino','Hiragino Mincho Pro',serif" },
  ポップ:    { radius: "20px", darkBg: "#1f1b4b", font: "-apple-system,BlinkMacSystemFont,sans-serif" },
  ビジネス:  { radius: "4px",  darkBg: "#1a2332", font: "-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" },
};

/** カラー設定とスタイル名からCSSデザインシステムを生成する */
export function generateLpCss(color: LpColorConfig, styleName: string): string {
  const s = STYLE_META[styleName] ?? STYLE_META["モダン"];
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:${s.font};color:#1a1a1a;background:#fff;line-height:1.8;font-size:15px;word-break:break-word;}
.lp-wrap{max-width:640px;margin:0 auto;}
a{color:inherit;text-decoration:none;}
img{max-width:100%;height:auto;display:block;}

/* ── Hero ── */
.hero{background:${color.bg};padding:56px 24px 48px;text-align:center;}
.hero-badge{display:inline-block;background:${color.primary};color:#fff;font-size:11px;font-weight:bold;padding:4px 14px;border-radius:20px;margin-bottom:16px;letter-spacing:.08em;}
.hero h1{font-size:2em;font-weight:900;line-height:1.3;margin-bottom:16px;color:${color.accent};}
.hero .hero-sub{font-size:.95em;color:#555;margin-bottom:28px;}

/* ── Section ── */
.section{padding:56px 24px;}
.section-alt{background:${color.bg};padding:56px 24px;}
.section-dark{background:${s.darkBg};color:#fff;padding:56px 24px;}
.section-title{font-size:1.45em;font-weight:900;text-align:center;margin-bottom:8px;line-height:1.4;}
.section-dark .section-title{color:#fff;}
.section-sub{text-align:center;font-size:.88em;color:#6b7280;margin-bottom:8px;}
.section-dark .section-sub{color:rgba(255,255,255,.65);}
.divider{width:40px;height:4px;background:${color.primary};border-radius:2px;margin:0 auto 32px;}

/* ── Card ── */
.card-grid{display:flex;flex-direction:column;gap:16px;margin-top:24px;}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:${s.radius};padding:20px 24px;box-shadow:0 2px 10px rgba(0,0,0,.07);}
.section-dark .card{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);}
.card-icon{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;background:${color.primary};color:#fff;border-radius:50%;font-weight:900;font-size:15px;margin-bottom:12px;}
.card h3{font-size:1.02em;font-weight:bold;margin-bottom:8px;}
.card p{font-size:.87em;color:#6b7280;line-height:1.7;}
.section-dark .card p{color:rgba(255,255,255,.6);}

/* ── Lists ── */
.check-list,.x-list{list-style:none;display:flex;flex-direction:column;gap:12px;margin-top:16px;}
.check-list li,.x-list li{display:flex;align-items:flex-start;gap:10px;font-size:.9em;line-height:1.6;}
.check-list li::before{content:"✅";flex-shrink:0;}
.x-list li::before{content:"❌";flex-shrink:0;}

/* ── CTA ── */
.cta-section{padding:48px 24px;background:${color.bg};text-align:center;}
.cta-btn{display:block;background:${color.primary};color:#fff;padding:18px 32px;border-radius:${s.radius};font-size:1.1em;font-weight:bold;max-width:400px;margin:0 auto 10px;box-shadow:0 4px 16px rgba(0,0,0,.18);letter-spacing:.03em;border:none;cursor:pointer;}
.cta-note{font-size:.78em;color:#6b7280;}

/* ── Steps ── */
.step-list{display:flex;flex-direction:column;gap:20px;margin-top:24px;}
.step{display:flex;gap:16px;align-items:flex-start;}
.step-num{display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:${color.primary};color:#fff;border-radius:50%;font-weight:900;font-size:15px;flex-shrink:0;}
.step-body h3{font-size:1em;font-weight:bold;margin-bottom:4px;}
.step-body p{font-size:.87em;color:#6b7280;}

/* ── Testimonial ── */
.testimonial{background:${color.bg};border-left:4px solid ${color.primary};border-radius:0 ${s.radius} ${s.radius} 0;padding:16px 20px;margin:12px 0;font-size:.9em;}
.testimonial .t-name{font-size:.78em;color:#6b7280;margin-top:8px;font-weight:bold;}

/* ── Compare Table ── */
.compare-table{width:100%;border-collapse:collapse;margin-top:24px;font-size:.87em;}
.compare-table thead th{background:${color.primary};color:#fff;padding:10px 14px;text-align:left;}
.compare-table tbody td{padding:10px 14px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
.compare-table tbody tr:nth-child(even) td{background:${color.bg};}
.yes{color:#16a34a;font-weight:bold;}
.no{color:#dc2626;font-weight:bold;}

/* ── Price ── */
.price-box{border:2px solid ${color.primary};border-radius:${s.radius};padding:28px 24px;text-align:center;background:${color.bg};margin-top:24px;}
.price-label{font-size:.85em;color:#6b7280;margin-bottom:8px;}
.price-val{font-size:2.4em;font-weight:900;color:${color.primary};line-height:1;}
.price-unit{font-size:.9em;font-weight:normal;}
.price-note{font-size:.78em;color:#6b7280;margin-top:8px;}

/* ── FAQ ── */
.faq-list{display:flex;flex-direction:column;margin-top:24px;}
.faq-item{border-bottom:1px solid #e5e7eb;padding:18px 0;}
.faq-q{font-weight:bold;display:flex;gap:10px;margin-bottom:8px;font-size:.95em;}
.faq-q .qm{color:${color.primary};flex-shrink:0;font-size:1.05em;}
.faq-a{display:flex;gap:10px;font-size:.87em;color:#6b7280;line-height:1.7;}
.faq-a .am{color:${color.primary};flex-shrink:0;font-size:1.05em;font-weight:bold;}

/* ── Misc ── */
.highlight{background:${color.bg};border-radius:${s.radius};padding:18px 22px;border:1px solid ${color.primary};margin:16px 0;}
.highlight strong{color:${color.primary};}
.tag{display:inline-block;background:${color.primary};color:#fff;font-size:11px;font-weight:bold;padding:2px 10px;border-radius:4px;margin-bottom:8px;}
`.trim();
}

/** AI に HTML 骨格だけを生成させるプロンプトを構築する */
export function buildDesignedLpPrompt(
  title: string,
  productName: string,
  styleName: string,
  referenceContent?: string,
): string {
  const refSection = referenceContent
    ? `\n## 参考サイトの文章（ライティングトーン・構成の参考のみ。コピー不可）\n${referenceContent}\n`
    : "";

  return `以下の仕様で日本語のランディングページHTMLを生成してください。

## 目的・商品
- ページの目的: ${title}
- 商品名: ${productName || "未設定"}
- デザインスタイル: ${styleName}
${refSection}
## 使用できるCSSクラス（このクラスのみ使用すること）
- .lp-wrap（最外側ラッパー）
- .hero > .hero-badge, h1, .hero-sub（ヒーロー）
- .section / .section-alt / .section-dark（セクション背景）
- .section-title, .section-sub, .divider（セクション見出し）
- .card-grid > .card > .card-icon, h3, p（カード）
- .check-list > li / .x-list > li（チェック・バツリスト）
- .cta-section > .cta-btn, .cta-note（CTA）
- .step-list > .step > .step-num + .step-body > h3, p（ステップ）
- .testimonial > .t-name（お客様の声）
- .compare-table（thead/tbody） .yes .no（比較表）
- .price-box > .price-label, .price-val, .price-note（価格）
- .faq-list > .faq-item > .faq-q(.qm), .faq-a(.am)（FAQ）
- .highlight, .highlight strong（強調ボックス）
- .tag（バッジタグ）

## 出力するセクション構成（この順番で）
1. .hero — バッジ【期間限定・先着○名】、強いキャッチコピー h1、サブコピー、<!-- HERO_IMAGE -->（画像プレースホルダー、そのまま記述）、CTAボタン「今すぐ申し込む」
2. .section-dark — "こんなお悩みありませんか？" .x-list で悩み4項目
3. .section-alt — 商品の概要・解決策を.highlightで強調
4. .section — "選ばれる3つの理由" .card-grid で3カード（.card-iconに番号01〜03）
5. .section-alt — "3ステップで始められる" .step-list
6. .section — お客様の声 .testimonial × 3件（名前は「○○さん（30代・会社員）」形式）
7. .section-dark — .compare-table で「本商品 vs 他の方法」3行比較
8. .section-alt — .price-box（価格を大きく表示）＋ .cta-btn
9. .section — .faq-list で4問
10. .cta-section — 締めのメッセージ(h2)＋ .cta-btn ＋ .cta-note（返金保証など）

HTMLのみ返してください（<!DOCTYPE>・<html>・<head>・<body>・<style>タグは不要、.lp-wrapで全体を囲む）。`;
}

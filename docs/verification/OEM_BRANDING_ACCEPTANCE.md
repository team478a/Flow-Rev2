# OEMブランド表示の受入確認

- **確認日**: 2026-08-03
- **確認方法**: **コードレベルの確認**（実装の追跡・ビルド出力）。実ブラウザでの目視確認は本作業環境から実施できないため未実施。
- **記載方針**: 実テナントのブランド名・ドメイン・問い合わせ先は記載しない。

---

## 1. 結論

| 画面 | ブランド名 | ロゴ | カラー | ファビコン | タイトル | フッター |
|---|---|---|---|---|---|---|
| `/admin/white-labels/[id]/edit`（本部・入力画面） | 入力 | 入力 | 入力 | 入力 | — | — |
| `/wl/*`（OEM管理） | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ 未実装 |
| `/dashboard`（クライアント管理） | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ 未実装 |
| `/my`（顧客） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**⚠️ 実画面での目視確認は未実施。** 上表はコードの追跡による確認であり、実際の描画・ファビコンのブラウザ反映は §5 の手順で確認が必要。

フッター（会社名・問い合わせ先・規約URL）は **`/my` のみ**に描画される。§4 参照。

---

## 2. 解決の仕組み

ルートの `app/layout.tsx` は静的な metadata しか持てず、どのテナントのリクエストかを知らない。テナントが確定するのはセッションを読むレイアウトなので、**ブランドの解決は各レイアウトで行う**。

```
app/wl/layout.tsx         → session.whiteLabelId       （自OEM）
app/(dashboard)/layout.tsx → session.whiteLabelId      （所属OEM）
app/my/layout.tsx          → session.whiteLabelId      （所属OEM）
```

いずれも `getWhiteLabelBranding(whiteLabelId)` を呼ぶ。この関数は表示に使う8列だけを取る軽量クエリで、**取得失敗時は `null` を返す**。

```ts
if (error || !data) return null;
```

`null` の場合、各画面は FlowRev の既定表示に落ちる。ブランド表示のためにページを落とすのは割に合わないという判断。呼び出し側も `.catch(() => null)` を重ねている。

---

## 3. ファビコンとブラウザタイトル

`features/branding/metadata.ts` の `buildBrandMetadata()` が担う。3つのレイアウトすべてが `generateMetadata()` から呼んでいる。

```ts
if (!whiteLabelId) return { title: fallbackTitle };
const branding = await getWhiteLabelBranding(whiteLabelId).catch(() => null);
if (!branding) return { title: fallbackTitle };

const metadata: Metadata = { title: branding.brandName || fallbackTitle };
if (branding.brandFaviconUrl) {
  metadata.icons = { icon: branding.brandFaviconUrl };
}
return metadata;
```

| 画面 | フォールバックタイトル |
|---|---|
| `/wl/*` | `FlowRev WL` |
| `/dashboard` | `FlowRev` |
| `/my` | `マイページ \| FlowRev` |

`brandFaviconUrl` が未設定なら `icons` を**そもそも設定しない**ため、壊れた画像リンクは発生しない。`brandName` が空文字列の場合も `|| fallbackTitle` で既定に落ちる。

---

## 4. フッター（会社名・問い合わせ先・規約）

`features/branding/brand-footer.tsx`。未設定項目の扱いが二段構えになっている。

```ts
if (!branding) return null;
const { companyName, supportEmail, termsUrl, privacyUrl } = branding;
if (!companyName && !supportEmail && !termsUrl && !privacyUrl) return null;
```

- 個別の項目が未設定なら、その行・リンクだけを省略する
- 4項目すべて未設定なら、**フッター自体を描画しない**（空の枠だけが残るのを避ける）

規約・プライバシーポリシーは外部サイトを指すため `next/link` ではなく素の `<a>` を使い、`target="_blank"` に `rel="noopener noreferrer"` を付けている。

### 現状の制約

**`BrandFooter` は `app/my/layout.tsx` からしか呼ばれていない。** `/wl` と `/dashboard` は `AppShell` を使っており、フッターの描画箇所が無い。

指示書 §10.4 が求める顧客画面のフッターは満たしているが、§10.2・§10.3 の管理画面には会社名・問い合わせ先・規約が出ない。管理画面は運営者向けで規約表示の必要性が低いため**今回は仕様判断が必要な項目として報告に留め、コードは変更していない**。

---

## 5. 実画面での確認手順（未実施）

### 5.1 本部管理画面 — `/admin/white-labels/[id]/edit`

1. 全項目を入力して保存する

| 入力項目 | 列 |
|---|---|
| ブランド名 | `brand_name` |
| ブランドカラー | `brand_color` |
| ロゴURL | `brand_logo_url` |
| ファビコンURL | `brand_favicon_url` |
| 会社名 | `company_name` |
| 問い合わせ先 | `support_email` |
| 利用規約URL | `terms_url` |
| プライバシーポリシーURL | `privacy_url` |

2. 保存後に再表示し、全項目が保持されていることを確認する

`updateWhiteLabel()` は `input.X !== undefined` で判定しているため、フォームが送らなかった項目は更新されない。**空文字を送った場合は空文字で上書きされる**点に注意（クリア操作として機能する）。

### 5.2 OEM管理画面 — `/wl/dashboard`

OEMオーナーでログインし、ヘッダのブランド名・ロゴ・カラー、ブラウザタブのタイトルとファビコンを確認する。

### 5.3 クライアント管理画面 — `/dashboard`

そのOEM配下のクライアントオーナーでログインし、**所属OEMの**ブランドが出ることを確認する。ここで FlowRev 既定が出る場合、`user_profiles.white_label_id` が未設定の可能性がある。

### 5.4 顧客画面 — `/my`

購入者アカウントでログインし、ヘッダのブランド＋フッターの会社名・問い合わせ先・規約リンクを確認する。

### 5.5 未設定OEMのフォールバック

ブランド項目を一切設定していないOEMを1つ用意し、以下を確認する。

- ヘッダに `FlowRev` 系の既定名が出る
- ファビコンが既定のまま
- **フッターが描画されない**（空の枠が出ない）
- 壊れた画像・空リンクが出ない

### 5.6 ファビコンの注意点

ブラウザはファビコンを強くキャッシュする。切り替えを確認する際はシークレットウィンドウまたはハードリロードを使うこと。表示されない場合、まず HTML の `<link rel="icon">` に期待するURLが出ているかを確認する。

---

## 6. 実装済みだが今回変更しないもの

指示書 §15 に従い、以下は変更していない。

| 項目 | 状態 |
|---|---|
| 独自ドメイン自動設定 | 未実装。`brand_domain` 列はあるが割当処理は無い |
| `/wl`・`/dashboard` のフッター | 未実装（§4）。仕様判断が必要 |
| `sender_name` によるメール差出人名 | **PR #22 で列ごと削除。** 差出人名は `email_settings.from_name` が担う |

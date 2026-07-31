# 07. 段階的移行計画（GitHub / Codex・Claude Code / Vercel / Supabase / GitHub Actions）

既存機能を壊さないことを最優先とし、各Phaseは独立してロールバック可能な単位に分割する。

---

## Phase 1: 開発環境の再現性確保とCI基盤

**目的**: 「typecheckが通る/通らない」を誰でも同じ結果で確認できるようにし、GitHub Actions上でtypecheck/buildを自動化する土台を作る。

**作業内容**:
- ルート`package.json`に`packageManager: "pnpm@10.33.0"`（実際に検証したバージョン）を追加。
- `artifacts/mockup-sandbox`の型エラー（`@types/react`バージョン不整合、01参照）を修正、またはルートの`build`/`typecheck`スクリプトから`mockup-sandbox`を意図的に除外し「flowrevのCIを阻害しない」状態にする。
- `.github/workflows/ci.yml`を新規作成し、`pnpm install` → `pnpm --filter @workspace/flowrev run typecheck` → `pnpm --filter @workspace/flowrev run build`（ダミー環境変数付き）を実行。

**変更対象**: `package.json`、`.github/workflows/ci.yml`（新規）、`artifacts/mockup-sandbox/src/components/ui/*.tsx`（型エラー修正の場合）

**受入条件**: PRを作成すると自動でtypecheck/buildが走り、結果がステータスチェックとして表示される。

**リスク**: 低（既存コードの実行結果には影響しない、CI追加のみ）。

**ロールバック方法**: ワークフローファイルの削除。

---

## Phase 2: Critical/Highセキュリティ修正（本番公開のブロッカー解消）

**目的**: `05_SECURITY_FINDINGS.md`のCritical(C-1, C-2)とHigh(H-1〜H-5)を解消し、実運用に耐える状態にする。

**作業内容**（優先順）:
1. C-1: Stripe Webhookの署名検証未設定時スキップを廃止（`app/api/webhooks/stripe/route.ts`）。
2. H-1: `/api/admin/scenarios/execute`にロールチェックを追加（`app/api/admin/scenarios/execute/route.ts`）。
3. C-2: LP新規タブプレビューのXSS対策（`features/lp/components/lp-html-editor.tsx`）。
4. H-3: `CRON_SECRET`/Webhook検証のフェイルオープンをフェイルクローズに変更。
5. H-4: `fetchReferenceText`にSSRFガードを追加。
6. H-2: AI生成・認証エンドポイントへのレート制限導入（既存の`rate_limits`テーブルを活用）。
7. H-5: 画像アップロードのマジックバイト検証追加。

**変更対象**: 上記各ファイル、必要に応じ`lib/repositories/*`。

**受入条件**: 各項目についてローカル/Preview環境で再現手順が塞がれていることを手動確認。

**リスク**: 中（既存の正常フローを壊さないよう、特にStripe Webhook修正は本番決済に直結するため、Preview環境で十分に検証してからProductionへ適用する）。

**ロールバック方法**: 各修正は独立したコミット/PRに分割し、問題が出た項目だけをrevertできるようにする。

---

## Phase 3: DBマイグレーション管理の統一

**目的**: 「SQLを手でコピペ」運用から脱却し、矛盾ファイルによる事故リスクを解消する。

**作業内容**:
- `0002_content.sql`・`0003_members_scenarios.sql`（重複・未使用ファイル）をアーカイブディレクトリへ移動するか削除（04参照）。
- `prod_setup.sql`にしか無い差分（`plans.white_label_id`列・関連RLSポリシー）を正規のmigrationファイルへ統合する。
- Drizzle migrationsかSupabase CLI migrationsのどちらかに一本化する意思決定を行い、以後の変更を新方式に統一する（既存スキーマの再現には現行SQLをそのまま初期migrationとして取り込む）。

**変更対象**: `artifacts/flowrev/supabase/migrations/*`、`SUPABASE_SETUP.md`、（Drizzle採用の場合）`lib/db/src/schema/*`

**受入条件**: 新規のSupabaseプロジェクトに対して、選定した方式のコマンド一発でスキーマ・RLSが再現できる。

**リスク**: 中（既存の本番/開発Supabaseプロジェクトには影響しない。新方式は「今後の変更」に適用し、過去分は現状のSQLをそのまま初期状態として取り込むため、破壊的変更にはならない）。

**ロールバック方法**: migration方式の変更はドキュメントとファイル整理のみで、DBに対する破壊的操作は本Phaseでは行わない。

---

## Phase 4: Vercel Preview/Production運用の整備

**目的**: 環境変数・Cron・pnpm設定を整え、Vercelでの運用を安定化する。

**作業内容**:
- Vercelダッシュボードで、Preview/Production双方に`06_VERCEL_READINESS.md`記載の環境変数を設定。
- `/api/admin/scenarios/execute`用のCronエントリを`vercel.json`に追加（Phase 2でロールチェックを直した後に有効化）。
- Root Directory設定の再確認。

**変更対象**: `artifacts/flowrev/vercel.json`、Vercelダッシュボード設定（コード外）。

**受入条件**: PreviewデプロイでLP生成・決済（テストモード）・メール送信が一通り動作確認できる。

**リスク**: 低〜中（Cron追加は新規の自動送信を有効化するため、テスト環境で送信内容を確認してから本番反映する）。

**ロールバック方法**: `vercel.json`のCronエントリ削除、環境変数の元設定への復元。

---

## Phase 5: Replit依存の整理

**目的**: Replit専用コード・設定を明確に分離し、Vercel/GitHub Actions/Codex環境での混乱を防ぐ（03参照）。

**作業内容**:
- `pnpm-workspace.yaml`の`stripe-replit-sync`・`@replit/vite-plugin-dev-banner`（未使用）の死んだエントリを削除。
- `REPLIT_DOMAINS`フォールバック（`features/invitations/actions.ts`）を削除し、`NEXT_PUBLIC_APP_URL`未設定時は即エラーにする。
- `artifacts/mockup-sandbox`/`artifacts/api-server`を今後も維持するか、Replit専用ツールとして明確に「本番と無関係」ドキュメント化するかを意思決定する。
- linux-x64限定の`overrides`を、GitHub Actionsのランナー方針（`ubuntu-latest`固定 or Mac対応）に応じて調整する。

**変更対象**: `pnpm-workspace.yaml`、`features/invitations/actions.ts`、（意思決定次第で）`artifacts/mockup-sandbox`、`artifacts/api-server`

**受入条件**: Vercel/GitHub ActionsどちらのビルドログにもReplit特有の警告・分岐が現れない。

**リスク**: 低。

**ロールバック方法**: 各変更は独立コミットで管理し、個別revert可能。

---

## Phase 6: 認証・テナント分離の残課題対応

**目的**: 04で指摘したRLS/招待フローの穴を塞ぐ。

**作業内容**:
- `ai_provider_settings`のRLSポリシーにロール条件を追加（M-5）。
- 招待受諾フローで、既存アカウントの役割上書きに確認ステップを追加（M-6）。
- `courses-public.ts`の`listPublishedLessons()`にテナント条件を追加（M-7、防御的修正）。

**変更対象**: `supabase/migrations/*`（新規ALTER/CREATE POLICY）、`features/invitations/accept-actions.ts`、`lib/repositories/courses-public.ts`

**リスク**: 低〜中（RLSポリシー変更は必ずPreview環境で既存フローが壊れないことを確認してから本番適用する）。

**ロールバック方法**: 追加したポリシー/条件のrevert。

---

## Phase 7: 購入後フォロー・未行動者検知のMVP自動化

**目的**: 02で「一部完成」と判定した機能を、実際に自動で動く状態に引き上げる。

**作業内容**:
- `/api/admin/scenarios/execute`をVercel Cronで定期実行するよう設定（Phase 2のロールチェック修正後）。
- `no_action`トリガー型シナリオの自動起動ロジックを追加（未行動者検知→フォロー自動化）。

**変更対象**: `vercel.json`、`lib/repositories/scenario-execution.ts`、関連UI。

**リスク**: 中（実際に顧客へメール/LINEが自動送信されるようになるため、送信内容・頻度をテナント運営者が事前確認できる導線を用意してから有効化する）。

**ロールバック方法**: Cronエントリの無効化。

---

## 全体の順序についての補足

上記はセキュリティリスクの高さと「土台を先に固める」ことを優先した順序。ユーザー提示の初期候補リスト（開発環境再現性→Replit分離→CI→DB統一→Vercel Preview→認証修正→購入後フォローMVP）と比較すると、**本監査の結果を踏まえてCritical/Highセキュリティ修正（Phase 2）をPhase 1の直後、Replit依存整理より前に前倒しすることを推奨する**。理由は、決済なりすまし(C-1)と管理画面XSS(C-2)は実運用開始前に必ず塞ぐ必要がある一方、Replit依存整理は開発体験の改善であり緊急性が相対的に低いため。

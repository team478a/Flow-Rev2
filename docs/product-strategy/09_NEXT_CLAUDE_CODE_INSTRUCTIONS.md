# 次セッションへの引き継ぎ指示

## 前提の確認

このドキュメントセット（`docs/product-strategy/00`〜`09`）は、ブランチ`docs/product-strategy-and-execution-plan`上で作成された。作業を始める前に以下を確認すること。

1. `docs/product-strategy-and-execution-plan`ブランチが本当に想定通りマージ済み/未マージのどちらの状態かを`git log`で確認する
2. `docs/product-strategy/00_FLOWREV_PRODUCT_PRINCIPLES.md`〜`07_IMPLEMENTATION_ROADMAP.md`を読み、方針・現状ギャップ・実装順序を把握する
3. `docs/product/`（ブランチ`feature/phase-1-activity-events-foundation`）の既存設計文書と矛盾がないか確認する（特にPhase 6以降のネイティブ運営機能着手時）

## 今回のセッションでやること（今回は着手しない）

**今回のラウンドでは実装を行わない。** 次回セッションで着手すべき最初の作業単位は以下。

## 次回セッションの最初のタスク: Task 1-1（AI設定の3階層フォールバック化）

`08_PHASE_1_DETAILED_PLAN.md`のTask 1-1をそのまま実施する。

- 新しいブランチを`main`から作成する（例: `feature/phase1-ai-settings-fallback`）
- 対象: `artifacts/flowrev/lib/repositories/ai-settings.ts`の`getActiveAiSetting()`
- お手本: `artifacts/flowrev/lib/repositories/email-settings.ts:105-149`の`getActiveEmailSetting(whiteLabelId)`と同じ「クライアント→WL→HQ」の3階層フォールバック構造にする
- DB変更は不要（既存テーブルにWL単位のユニーク制約が既にある）
- 呼び出し元をすべて洗い出し、シグネチャ変更が必要であれば追随させる
- テスト: クライアント単位設定あり／WL単位のみ／どちらもなし、の3パターンで正しい設定が返ることを確認
- 完了したらtypecheck・build・既存の関連テストを実行し、結果を報告する
- 小さい1タスクなので、このタスク単体でPRを作成してよい（`00`文書7章の原則通り）

## 次回セッション開始時に確認すべきこと（人間の判断が必要な項目）

1. **実装順序の承認**: `07_IMPLEMENTATION_ROADMAP.md`のPhase 1〜9の順序でよいか、それとも先にブランド設定（Phase 2）から着手したいか、事業上の優先度を確認する
2. **利用量計測の粒度**: Phase 5で計測する項目（AI生成・メール送信・LINE送信・ストレージ）のうち、どれを最優先にするか
3. **監査ログの保持期間・閲覧範囲**: `audit_logs`をOEM事業者にどこまで見せるか（自社配下のみか、匿名化した全体傾向も見せるか）
4. **Cloudflare設定のテナント列追加**: 既存の単一グローバル行をどう移行するか、実際のスキーマを見た上で最終設計する（`08`文書Task 1-4で「要確認」としている部分）
5. **データ所有権・契約解除時のデータ扱い**: `03`文書8章で「今回のロードマップ対象外」とした論点を、いつ扱うか
6. **`docs/product/`との統合**: `feature/phase-1-activity-events-foundation`ブランチの内容を`main`にどう統合するか（別PRか、Phase 6着手時にまとめてマージするか）

## やってはいけないこと（今回の指示書で明示された禁止事項の再確認）

- 大規模な機能実装・全面リライトを一度に行わない
- 本番DBへのマイグレーション適用は明示承認なしに行わない
- 本番環境変数の変更は行わない
- `main`への直接コミットは行わない
- 既にマージ済みのPR #1に大きな追加を行わない
- Stripe Connect・自動売上分配は実装しない
- 高度なカスタムドメイン・ログイン代行は実装しない
- 高機能なビジュアルオートメーションビルダーは作らない
- Onbizu連携・CommitRev連携は実装しない
- AIによる無承認の自動送信は実装しない（提案→承認→送信の順を必ず経る）

## ドキュメントの位置付け

`docs/product-strategy/`配下の10文書は、今後の実装判断の基準となる。実装中に方針と食い違う判断が必要になった場合は、コードを先に変更するのではなく、まずこの文書セットの該当箇所を更新してから実装に進むこと。

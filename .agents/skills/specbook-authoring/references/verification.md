# Verification: 証拠と合否の計画

**置き場所:** `docs/verification/`。**Type:** `verification`。**必須relation:** `relations` に `requirement`・`design`・`architecture`・`contract` のいずれかのキーで**少なくとも1つの既存artifact**を指さなければならない。

Verification artifactは、不変条件・requirement・architecture・protocolが満たされているかをどう判定するかを規定する。実際の結果を記録してもよいが、計画と結果は区別しなければならない。

## 推奨する内容

- **対象:** リンクしたartifact ID、範囲、対象とするリスク。
- **環境・前提条件:** ランタイム版・依存・fixture・資格情報や分離（秘密を露出しない）。
- **テストシナリオ:** 手順・期待出力・異常/境界ケース。
- **証拠:** コマンド・トレース・スクリーンショット・ログ・日付。**実行後にのみ**記録。
- **結果:** planned / passed / failed / blocked。制限と再現情報を添え、成功を黙って推測しない。

relation の例:

```yaml
relations:
  requirement:
    - '00002'
```

例のIDは許可typeの実在対象に置き換える。ドキュメントの `status: accepted` は**全テスト合格と同義ではない**。結果の記述は別途明示する。

## レビュー

旧実装の退行確認だけでなく、新しいcontractや失敗経路に関する主張を検証する。テスト実行やカバレッジ結果を絶対に捏造しない。

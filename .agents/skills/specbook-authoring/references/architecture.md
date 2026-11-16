# Architecture — システム全体の構造

**置き場所:** `docs/architecture/`。**Type:** `architecture`。**必須relation:** なし。

複数機能にまたがる境界に Architecture を使う: componentの責務、信頼境界、デプロイトポロジー、プロセス寿命、高レベルのデータ/制御フロー。詳細なendpoint schemaやメソッド動作は Contract/Design に置く。

## 推奨する内容

- **コンテキストと範囲:** 記述するシステムと影響するactor。
- **コンポーネント・責務:** 責務と、各componentが意図的に担わないこと。
- **依存方向:** どの部分が他を呼び・依存してよいか。
- **ランタイム・デプロイトポロジー:** Node・プロセス・所有・ライフサイクル・障害。
- **重要なフロー:** メッセージとセキュリティ境界。簡単な図が望ましい。
- **前提・未解決の問い:** 特に作り直しに関係する未知数。

該当するRequirementへの `addresses` を宣言してよいが、Designと違って旧Specbook schemaでは必須ではない。`perspective` はArchitectureとDesignにのみ許可される。scopeごとに1つの正本Architectureを保ち、関連するsub-architectureは複製せずリンクする。

## レビュー

*旧*Plugumiのプロセス構成を新しいarchitectureへ押し込まない。観測された振る舞いと提案モデルを分ける。新たに決めない限り、便宜上の理由でAI非依存のCoreへPluginのドメインロジックを埋め込まない。

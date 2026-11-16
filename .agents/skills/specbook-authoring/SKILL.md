---
name: specbook-authoring
description: docs/goals, requirements, architecture, designs, decisions, contracts, verification, guides 配下の Specbook 形式 Markdown/YAML ドキュメントの作成・編集・整理・手動レビュー。設計計画・機能要件・プロトコル決定・ドキュメント再構成・relation/frontmatter の確認に使う。旧Plugumi実装を既定仕様として使わない。
---

# Specbook ドキュメント作成（手動ワークフロー）

新しいPlugumiの設計ドキュメントを **Markdown + YAML frontmatter** として管理する。実行中のSpecbook Pluginは不要。ドキュメントが正本であり、将来のSpecbook実装がこれを読む可能性がある。

## 最初に: artifact type を決める

ユーザーのタスクに該当する reference を参照する。関連する type の reference と [conventions](references/conventions.md) だけを読み、ドキュメント間 relation を作る場合に限り追加の type を読む。

| Type | ディレクトリ | 答える問い | Reference |
|---|---|---|---|
| `goal` | `docs/goals/` | プロダクトはなぜ存在し、どんな成果が大事か | [goal](references/goal.md) |
| `requirement` | `docs/requirements/` | 何が満たされなければならないか | [requirement](references/requirement.md) |
| `architecture` | `docs/architecture/` | システム全体の境界と関係は何か | [architecture](references/architecture.md) |
| `design` | `docs/designs/` | 特定のrequirementをどう満たすか | [design](references/design.md) |
| `decision` | `docs/decisions/` | どの選択をし、なぜか | [decision](references/decision.md) |
| `contract` | `docs/contracts/` | 外部から観測可能などのI/F・形式に合意したか | [contract](references/contract.md) |
| `verification` | `docs/verification/` | 適合をどう確認するか | [verification](references/verification.md) |
| `guide` | `docs/guides/` | 利用者・開発者はどう使うか | [guide](references/guide.md) |

`docs/designs/`（複数形・artifact type）と旧来の `docs/design/` ディレクトリを混同しない。現行のdecisionディレクトリとして旧 `docs/adr/` を作らない。

## ワークフロー

1. **コンテキストを確立する。** まずリポジトリと既存 `docs/` ファイルを調べる。accepted の requirement/decision と draft・deprecated を区別する。旧Plugumiリポジトリ・過去のPoC・過去の議論は検討の入力であり、今回の作り直しの拘束力ある仕様ではない。
2. **type と scope を選ぶ。** 関心事ごとに1つの主artifactを選ぶ。小さく独立にレビューできる requirement・design を好むが、ドキュメント数を増やすためだけに分割しない。
3. **書く前に関係を探す。** 対象IDと現在の正本を検索する。designは既存のrequirementへのrelationを持たなければならず、verificationは既存の検証対象へのrelationを持たなければならない。必要な前提が無ければ先に作る。relation IDを捏造しない。
4. **書く前に方針を確認する。** 新しい設計判断・製品方針・曖昧な解釈を含む場合は、決定事項を列挙してユーザーに確認してから書く。質問回数に制限はない — 推測で方向を決めず、確認なく内容を増やさない。
5. **ファイル名を割り当てる。** 対象typeフォルダの `NNNNN-*.md` を走査し、そのフォルダ内で一意な次の5桁ID（max + 1）を選び、安定した kebab-case の slug を使う。IDはYAMLではなくファイル名から導かれる。整理のためだけに旧IDを振り直さない。
6. **作成・更新する。** `templates/<type>.md` から始めてプレースホルダを置き換える。意味のある節だけを残す。`type`・`title`・`description`・`status` とそのtypeに必要な relation を埋める。明示的な合意がない限り `draft` を使う。第二の正本を作らず、既存artifactを編集する。
7. **手動レビューする。** ファイル名・フォルダ・typeの一致、ID・対象type・循環、必須フィールド、references・`sources`、意味の正確さ、関連ドキュメントの更新要否を確認する。[conventions](references/conventions.md) 参照。
8. **変更を報告する。** 作成・変更したパス、影響する relation、未解決の疑問、実行しなかったチェックを列挙する。Specbook Pluginで検証していないのに検証済みと主張しない。

## やってはいけないこと

- ユーザーに確認せず、設計判断・製品方針・open questionの結論を自分で決めて書かない
- 確認のための質問を省かない（質問回数に制限はない）
- 旧ドキュメント・旧API契約・旧パッケージ境界を自動的に移植しない
- 未承認のproposalやdeprecated artifactを現行契約として扱わない
- 実装状況・計測値・承認・ソースファイル・relation ID・検証結果を捏造しない
- incoming/children/siblings/`id`/`updated_at` をYAMLへコピーしない。incoming linkは外向きrelationから導出される
- 既存の正本となるdecision・contract・ルールを繰り返す第二のドキュメントを作らず、そのIDへリンクする
- `sources` を埋めるためだけに実在しないソースファイルを作らない。ソースができるまで `sources` を省略する
- 通常の編集にSpecbook Pluginやカスタムスクリプトを要求しない。manual-first のskillである

## type横断の作成順序

新しい機能の場合、一般的な順序は次の通り:

`goal`（新しいプロダクト成果なら）→ `requirement` → `architecture`（システム境界が変わるなら）→ `decision`（重要な選択をしたとき）→ `design` → `contract`（I/Fの仕様が要るとき）→ `verification` → `guide`（利用・開発手順が要るとき）。

これは**指針であり、全変更に必須のフルセットではない**。decisionがdesignに先行することもあり、I/Fはdesignを起こさずcontractとしてモデル化できる。ツリーを埋めることより正確さを優先する。

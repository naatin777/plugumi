# 形式・識別子・relation の規約

旧Plugumi Specbook実装のartifactモデルに倣った規約。新しい作り直しの**出発形式**であり、現在validatorが導入済みであることの証明ではない。新プロジェクトが別の契約を明示採用した場合は、artifactを書く前にこのreferenceとtemplatesを一緒に更新する。

## ディレクトリとファイル名

```
docs/
├── glossary.md     # 用語の正本（typeを持たない単一ファイル）
├── goals/          # type: goal
├── requirements/   # type: requirement
├── architecture/   # type: architecture
├── designs/        # type: design
├── decisions/      # type: decision
├── contracts/      # type: contract
├── verification/   # type: verification
└── guides/         # type: guide
```

`docs/glossary.md` はtype・IDを持たない単一ファイルで、プロジェクト用語の正本とする。

各artifactファイルは `docs/<folder>/<5桁ID>-<kebab-case-slug>.md`。例: `docs/designs/00007-tool-execution.md`。IDは**各typeディレクトリ内で一意**（フォルダ内連番・グローバル連番ではない）で、YAMLではなくファイル名から導かれる。作成時はそのフォルダの既存IDを走査して max + 1 を使い、deprecated IDを再利用しない。

## frontmatter

```yaml
---
type: design
title: Tool実行
description: designが管轄する内容
status: draft
relations:
  requirement:
    - '00002'
---
```

必須キー: `type`・`title`・`description`・`status`。`status` は `draft | accepted | deprecated`。任意キー: `tags`・`sources`・`subtype`・`relations`・`perspective`（**design と architecture のみ**）。推奨: 5桁IDは引用符で囲み、先頭ゼロを保つ。本文の見出しは提案であり、スキーマ要件ではない。

`status: accepted` は明示的な合意を要する。実装した・草案を書いただけでは自動的にacceptedにならない。`deprecated` artifactは履歴として残し、新しい側は同typeキーのrelationで旧版を指す（本文で「supersedes」等の関係を明記する）。

`id`・`path`・`slug`・`updated_at`・`incoming`・`children`・`siblings` を frontmatter に永続化**しない**。逆リンクは導出される。外向きリンクはすべて `relations` 内に置く。

## relation

`relations` の**キーは参照先のtype名**、値はそのtypeフォルダ内の5桁IDのリスト。

```yaml
relations:
  architecture:
    - '00001'
  requirement:
    - '00002'
    - '00004'
```

- 使えるキー: `goal` `requirement` `architecture` `design` `decision` `contract` `verification` `guide`
- IDはキーのtypeフォルダ内で解決されるため、`'00001'` が複数フォルダに存在しても一意になる
- 保存するのは外向きrelationのみ。逆参照は自動的に算出し、保存しない
- IDの振り直し・再利用はしない

**関係の意味はキーには含まれない。** 「addressする」「verifyする」「supersedeする」等の意味は本文で記述する。この形式では旧来のrelation名（`parent`/`addresses`/`applies_to`/`verifies`/`depends_on`/`related_to`/`contributes_to`/`documents`/`supersedes`）は使わない。

残る構造的なルール:

| 元type | 必須relation | 備考 |
|---|---|---|
| `design` | `requirement` キー ≥ 1 | 少なくとも1つのrequirementを満たす |
| `verification` | `requirement`・`design`・`architecture`・`contract` のいずれか ≥ 1 | 検証対象が必須 |
| その他 | なし | 階層（parent相当）・置換（supersedes相当）・依存は本文と同typeキーで表現 |

対象IDの実在とキーのtype名の正しさを確認する。対象の重複・自己参照を避ける。draftを改訂しても必須relationは維持する。前提が不明なartifactにはIDを捏造せず、前提を作るか「まだ妥当になれない」ことを明示して報告する。

## `sources` と contract ファイル

`sources` はリポジトリルート相対の**実在するソースパス**（絶対パスでも任意URLでもない）。実装ができるまで省略する。`contract` ドキュメントはリポジトリ内の実在する OpenAPI・JSON Schema・`.proto` 等を指してバージョン管理・意味を説明してよいが、それらのファイルが存在するふりをしない。

## 手動レビューのチェックリスト

1. すべての `NNNNN-*.md` のIDがそのフォルダ内で一意である
2. フォルダ・`type`・ファイル名が一致し、`title`・`description`・`status` がある
3. 計算フィールドを永続化していない、`sources` を捏造していない
4. `relations` のキーが有効なtype名であり、値のIDがそのtypeフォルダ内に実在し、引用符付き5桁文字列である
5. すべてのdesignが `requirement` キー ≥ 1 を持ち、すべてのverificationが `requirement`・`design`・`architecture`・`contract` のいずれか ≥ 1 を持つ
6. 同type relationの循環（parent相当）がない。異type間の循環は指摘する
7. 節が一貫した主題を記述し、合意済みの事実と未解決の問いを区別する
8. あるartifactの変更が、依存するcontract・design・テスト・guideと整合している

**手動レビュー** は `validation/repository` の実行成功と同等ではない。現行validatorを実際に実行しない限り、エンジン検証済みの互換性を主張しない。

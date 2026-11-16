# 形式・識別子・relation の規約

旧Plugumi Specbook実装のartifactモデルに倣った規約。新しい作り直しの**出発形式**であり、現在validatorが導入済みであることの証明ではない。新プロジェクトが別の契約を明示採用した場合は、artifactを書く前にこのreferenceとtemplatesを一緒に更新する。

## ディレクトリとファイル名

```
docs/
├── goals/          # type: goal
├── requirements/   # type: requirement
├── architecture/   # type: architecture
├── designs/        # type: design
├── decisions/      # type: decision
├── contracts/      # type: contract
├── verification/   # type: verification
└── guides/         # type: guide
```

各ファイルは `docs/<folder>/<5桁ID>-<kebab-case-slug>.md`。例: `docs/designs/00007-tool-execution.md`。IDは**各typeディレクトリ内で一意**（フォルダ内連番・グローバル連番ではない）で、YAMLではなくファイル名から導かれる。作成時はそのフォルダの既存IDを走査して max + 1 を使い、deprecated IDを再利用しない。

## frontmatter

```yaml
---
type: design
title: Tool実行
description: designが管轄する内容
status: draft
relations:
  addresses:
    - '00002'
---
```

必須キー: `type`・`title`・`description`・`status`。`status` は `draft | accepted | deprecated`。任意キー: `tags`・`sources`・`subtype`・`relations`・`perspective`（**design と architecture のみ**）。推奨: 5桁IDは引用符で囲み、先頭ゼロを保つ。本文の見出しは提案であり、スキーマ要件ではない。

`status: accepted` は明示的な合意を要する。実装した・草案を書いただけでは自動的にacceptedにならない。`deprecated` artifactは履歴として残し、必要なら新しい側が `supersedes` でリンクする。

`id`・`path`・`slug`・`updated_at`・`incoming`・`children`・`siblings` を frontmatter に永続化**しない**。逆リンクは導出される。外向きリンクはすべて `relations` 内に置く。

## relation

| Relation | 元type | 先type | 要件 |
|---|---|---|---|
| `parent` | `decision` 以外すべて | 同type | 任意。循環不可 |
| `supersedes` | すべて | 同type | 任意。循環不可 |
| `depends_on` | すべて | 任意artifact | 任意。循環は警告 |
| `related_to` | すべて | 任意artifact | 任意。相互表示は導出 |
| `contributes_to` | `requirement` | `goal` | 任意 |
| `addresses` | `design`・`architecture` | `requirement` | **designは非空必須**。architectureは任意 |
| `applies_to` | `decision` | 任意artifact | 任意 |
| `verifies` | `verification` | `requirement`・`design`・`architecture`・`contract` | **非空必須** |
| `documents` | `guide` | 任意artifact | 任意 |

保存するのは外向きrelationのみで、逆は保存しない。対象IDの実在とtype要件を確認する。対象の重複・自己参照を避ける。draftを改訂しても必須relationは維持する。前提が不明なartifactにはIDを捏造せず、前提を作るか「まだ妥当になれない」ことを明示して報告する。

## `sources` と contract ファイル

`sources` はリポジトリルート相対の**実在するソースパス**（絶対パスでも任意URLでもない）。実装ができるまで省略する。`contract` ドキュメントはリポジトリ内の実在する OpenAPI・JSON Schema・`.proto` 等を指してバージョン管理・意味を説明してよいが、それらのファイルが存在するふりをしない。

## 手動レビューのチェックリスト

1. すべての `NNNNN-*.md` のIDがそのフォルダ内で一意である
2. フォルダ・`type`・ファイル名が一致し、`title`・`description`・`status` がある
3. 計算フィールドを永続化していない、`sources` を捏造していない
4. 外向きrelationのIDがすべて実在し、引用符付き5桁文字列で、許可されたtypeである
5. すべてのdesignが `addresses` ≥ 1 のrequirementを持ち、すべてのverificationが `verifies` ≥ 1 の許可対象を持つ
6. `parent`・`supersedes` の循環がない。`depends_on` の循環は指摘する
7. 節が一貫した主題を記述し、合意済みの事実と未解決の問いを区別する
8. あるartifactの変更が、依存するcontract・design・テスト・guideと整合している

**手動レビュー** は `validation/repository` の実行成功と同等ではない。現行validatorを実際に実行しない限り、エンジン検証済みの互換性を主張しない。

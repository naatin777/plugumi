---
type: decision
title: package directoryはleafを完全修飾名にしてvariantの拡張に備える
description: packages/直下のフォルダ名をruntimeやviewのような裸の概念名にすると、言語版・framework bindingの追加時に自分が何者かを表現できなくなるため、leafを修飾した名前にする方針を記録する。
status: draft
relations:
  decision:
    - '00026'
---

## コンテキスト

`packages/` にはSDK類を置くが、単に `packages/runtime`・`packages/view` とすると拡張時に破綻する。variantの次元はfamilyごとに異なる：

- **runtime** — 言語次元。pluginはprocessなのでTS / Go / Rust等どの言語でも書きうる。TS版は参照実装
- **view** — framework次元。browserで動く以上言語はJSに固定されるが、react / solid等のbindingはありうる

npm package名はこの問題を持たない。npm registry自体がJSを意味するため言語修飾は不要で、framework bindingだけ `-react` のようなsuffixを足せば足りる。問題はrepo内のフォルダ構造の方で、polyglotなvariantを置いたときに裸の名前では曖昧になる。

## 決定

- `packages/` 直下はflatを保ち、leaf名を完全修飾にする：`runtime-ts`、`view-core`
- 将来のvariantは兄弟として足す：`runtime-go`、`view-react` など
- npm package名は変えない。無印（`@plugumi/runtime`、`@plugumi/view`）はJS/TSの参照実装・coreが名乗り、framework bindingだけsuffixを足す。フォルダ名とnpm名は一致しなくてよい（フォルダはrepo内のtaxonomy、npm名はpublishされたidentity）
- 非JS SDKはpnpm workspaceの対象外になるが、`packages/` の責務定義（00026）は言語を限定していないので同じtreeに置いてよい。Go module等が増えて管理上の問題が出たら、その時点で言語ツリーへの再編を検討する

## 代替案

**family入れ子（`runtime/ts`、`view/core`）。** taxonomyは明示できるが、全packageに1階層の深さ税がかかり、variantが1つしかないfamilyにも同じ構造を強いる。採用しない。

**言語ツリー（`ts/runtime`、`go/runtime`）。** polyglot repoの標準的な構造で tooling境界は綺麗だが、TSが参照実装で大半を占める現状では大げさ。採用しないが、非JS SDKが増えたときの再編先としては最有力。

**何もしない（裸の名前のまま）。** variant追加時に既存フォルダが何者か分からなくなり、その時点でのrenameは依存が増えた後で高くつく。採用しない。

## トレードオフと帰結

得るもの: variant追加が常に「兄弟を1つ足す」で済み、フォルダ名だけで実装の言語・frameworkが読み取れる。renameは依存が少ない今なら安い。

失うもの: フォルダ名とnpm名が一致しないため、package.jsonを開くまでpublished名が分からない。monorepoでは一般的なトレードオフだが、初見の人は軽く混乱しうる。

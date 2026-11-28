---
type: decision
title: packagesとsharedを公開予定ではなく責務の共有範囲で分ける
description: 開発途中の段階では公開APIかどうかでpackagesとsharedを分けず、汎用libraryとfirst-party shared implementationという位置づけで扱う方針を記録する。
status: draft
relations:
  decision:
    - '00008'
    - '00025'
---

## コンテキスト

現行リポジトリには `packages/` と `shared/` がある。`packages/` には `plugin-client`・`plugin-view`、`shared/` には `workbench`・`theme`・`files` が置かれている。

ここで一度「`packages/` は外部公開するSDK、`shared/` は公式UI内部の共有実装」という整理が出た。しかし、公開はまだ先であり、開発途中の directory 境界を公開予定の有無で決めるのは実態に合わない。また `shared/` に置くものはUIだけとは限らない。

## 決定

- 現段階では、外部公開するかどうかを `packages/` と `shared/` の分類基準にしない
- `packages/` は、比較的汎用なlibrary / SDK / protocol補助実装を置く場所として扱う。公開するかどうかではなく、product specificな画面やhost実装から独立した責務を持つことを重視する
- `shared/` は、first-party component間で共有する実装を置く場所として扱う。UIに限定しない。shell、panel、host補助、non-UIな共有実装も入りうる
- `packages/plugin-client` のようなlegacy化したものは、directory名で公開性を判断せず、実際の依存とprotocol移行に従って置き換え・削除する

## 代替案

**公開予定の有無で分ける。** npm publishや外部利用者の有無でdirectoryを分ける方法。公開がまだ先の現段階では、将来の公開予定を仮定した分類になり、実装中の依存整理を助けないため採用しない。

**`shared/` をUI専用にする。** 公式UI実装の置き場としては分かりやすいが、UI以外にもfirst-party component間で共有したい実装はあるため採用しない。

## トレードオフと帰結

得るもの: 公開計画が未定の段階でも、実装の依存関係と責務を基準にdirectoryを整理できる。

失うもの: `packages/` に置かれたものが外部公開されるとは限らず、`shared/` に置かれたものがUIとは限らない。境界は公開性や技術種別ではなく責務の共有範囲なので、個別の配置はそのつど確認する必要がある。

`plugin-client` は現行のagentとElectronが依存しているため即時削除できない。operation / Execution protocolへの移行で依存を剥がし、legacy SDKとして削除するかどうかを別途判断する。

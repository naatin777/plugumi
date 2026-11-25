---
type: decision
title: 標準搭載とPluginの境界をappsの知識で定め、個別caseの帰属を決める
description: 標準搭載を「appsがその存在を知りfirst-classなUXを持つこと」と定義し、terminal・DiffViewer・browser automation・git・docker/ssh・AI agentの帰属を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00017'
---

## コンテキスト

modstrataの「全部Plugin」は実験として有用だったが、寿命・trust level・targetの異なるものが同じ枠に入り扱いづらかった。Plugumiはcapability-centric workbenchとし、内部のoperation / execution / event機構はuniformにしつつ、概念と寿命とUXはuniformにしない方向で検討してきた（[Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md)、[Decision 00021](00021-plugin-narrowed-definition-and-naming.md)）。

その場合に必要なのが「どこまでを標準搭載し、どこまでをpluginにするか」の判断基準である。

## 決定

**標準搭載の定義**: coreへの組み込みではなく、**apps（公式host/shell）がその存在を具体的に知り、first-classなUXを持つこと**とする。capability機構はuniformなままで、問いは「shellがハードコードしてよい安定した意味を持つか」である。

**標準搭載の積極的理由**は2つある。

1. apps固有のnative統合はhost実装の内側にしか置けない（Electronのwebview、file explorerのdrag & dropやFinderとの相互受け渡し）
2. environmentは開発用途でほぼ必須であり、同梱しない選択肢がない

**個別caseの帰属**:

- **terminal** — 標準environment統合。PTYはenvironmentでdurableに生き、viewはplatformが持つ
- **DiffViewer** — 標準。テキストdiffで動き、gitの意味を必要としない
- **Electronのbrowser automation** — Electronでしか実現できないためhost capability。durable service化しない
- **git** — 標準搭載しない。shellにgit専用UIを置かず、capabilityはplugin / domain寄りとする。jjなど別VCSも存在し、DiffViewerはgitなしで成立する
- **docker / ssh remote** — provisioning driverはplugin。主な仕事はenvironmentを外部で起動することで、接続後は「リモートのenvironmentバイナリへポートで接続する」共通経路に収束する。設定画面に出る由来（docker経由、ssh/url）はopaqueな文字列メタデータとしてgenericに表示し、appsはdocker固有のUIロジックを持たない。なお接続後のremote environment protocolはcore側の責務である
- **AI agent** — appsが知るのは特定の実装ではなく「agentという概念」（chat UI、presence、interaction提示）とする方向。実装の帰属はMVP検討で決める（後述）

## 代替案

**全部pluginのまま意味づけだけ行う。** 分類を作れば改名なしで解決できるが、apps固有機能（webview等）はplugin機構では実現できず、environmentの同梱保証もできないため不十分。

**docker/sshのprovisioningを標準搭載する。** bootstrapの保証はlocal environmentが標準で存在するため不要であり、provisioningは追加機構なのでpluginに置ける。

## トレードオフと帰結

得るもの: 判断が「公式UXが何を約束するか」という製品の問いに還元され、迷ったときの基準が明確になる。標準搭載してもcapability機構はuniformなので、plugin側の拡張性を失わない。

失うもの・残課題:

- **capability indirection**は未解決。「capability + targetで呼ぶ」なら呼び出しの正本がregistrationId + toolPathから変わり、Contract 00004の呼び出し契約に影響する。復元draftをacceptedにする前にここを決める必要がある
- **AI agentの標準搭載は未確定**。native UIによるパフォーマンス利点、そもそもカスタマイズ性が要るか（forkとAIがある）という論点があり、MVPの検討で決める
- **MVPの範囲は未決定**。関心はagent / A2UI周りで、design 00007-00009が材料になる
- 細部は実装してから決める方針

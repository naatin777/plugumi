---
type: decision
title: built-inとPluginの境界を製品体験で定め、個別caseの帰属を決める
description: 標準装備という呼称をbuilt-inへ改め、terminal・DiffViewer・browser automation・git・docker/ssh・AI agentの帰属を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00017'
    - '00024'
    - '00029'
---

## コンテキスト

modstrataの「全部Plugin」は実験として有用だったが、寿命・trust level・targetの異なるものが同じ枠に入り扱いづらかった。Plugumiはoperation / Execution中心のworkbenchとし、内部のoperation / execution / event機構はuniformにしつつ、概念と寿命とUXはuniformにしない方向で検討してきた（[Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md)、[Decision 00021](00021-plugin-narrowed-definition-and-naming.md)）。

その場合に必要なのが「どこまでを製品の基本体験に入れ、どこからをpluginにするか」の判断基準である。以前はこれを「標準装備」「標準搭載」と呼んでいたが、語が分かりにくく、bundled / first-class / baselineなどの分類語を増やすと配布前の現段階では過剰である。

## 決定

**標準装備という語は使わず、`built-in` を使う。**

`built-in` は、利用者が追加installしなくても製品の基本体験として最初から使えるものを指す。実装場所を意味しない。UI App内、shared shell、Environment Provider、その他のprovider実装のどこにあってもよい。

細かい性質を説明する必要があるときは、正式用語を増やさず普通の文章で説明する。少なくとも現段階では、`first-class`、`baseline`、`bundled`、`official plugin`、`bundled plugin`、`built-in plugin` を正式な分類語として使わない。

**個別caseの帰属**:

- **terminal** — built-in。PTYはenvironmentでdurableに生き、viewはplatformが持つ
- **file explorer** — built-in view。plugin systemの外で起動できる基本体験とする。filesystem operationそのものはEnvironment Providerに置く
- **DiffViewer** — built-in。テキストdiffで動き、gitの意味を必要としない
- **Electronのbrowser automation** — Electron appのbuilt-in operation。durable service化しない
- **filesystem / shell / terminal / process / network接続** — built-in environment operation。Coreへ内蔵せず、Environmentが実装し、Environment Provider経由でCoreへ提供する
- **git** — built-inにしない。shellにgit専用UIを置かず、operationはplugin寄りとする。jjなど別VCSも存在し、DiffViewerはgitなしで成立する
- **docker / ssh remote** — provisioning driverはplugin。主な仕事はenvironmentを外部で起動することで、接続後は同じremote environmentの経路へ収束する。SSH経由ではSSH先でremote Environmentを起動し、そのremote EnvironmentがCoreへ接続する。設定画面に出る由来（docker経由、ssh/url）はopaqueな文字列メタデータとしてgenericに表示し、appsはdocker固有のUIロジックを持たない
- **AI agent** — 一旦built-inにはせず、pluginとして扱う。built-inへ格上げするかはMVPの検証後に見直す

## 代替案

**全部pluginのまま意味づけだけ行う。** 分類を作れば改名なしで解決できるが、UI App固有機能（webview等）はplugin機構では実現できず、environmentの同梱保証もできないため不十分。

**bundled / first-class / baselineなどの分類語を正式化する。** 配布や公開plugin運用が近づけば必要になる可能性はあるが、現段階では用語数が増えるだけであり、製品判断を複雑にするため採用しない。

**docker/sshのprovisioningをbuilt-inにする。** bootstrapの保証はlocal environmentが存在するため不要であり、provisioningは追加機構なのでpluginに置ける。

## トレードオフと帰結

得るもの: 判断が「製品の基本体験に何を入れるか」という問いに還元され、迷ったときの基準が明確になる。built-inでもoperation / Execution機構はuniformなので、plugin側の拡張性を失わない。

失うもの・残課題:

- `official` や `bundled` の区別が必要になるのは、外部配布やplugin配布を実際に設計するときである。それまでは正式用語を増やさない
- **AI agentは一旦plugin**。native UIによるパフォーマンス利点、そもそもカスタマイズ性が要るか（forkとAIがある）という論点があり、built-inへ格上げするかはMVPの検証後に見直す
- **MVPの範囲は未決定**。関心はagent / A2UI周りで、design 00007-00009が材料になる
- 細部は実装してから決める方針
- files.tsxの「provider側にUIは置かない（Decision 00017）」という参照は00017（UI App境界）の主旨とずれている可能性があり、根拠の確認と参照修正が必要

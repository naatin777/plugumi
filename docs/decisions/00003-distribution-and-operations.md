---
type: decision
title: 配布・管理・認証の置き場所
description: Pluginの配布形態、Core Daemonの管理面、外部サービス認証の委譲先、UI Appの位置づけを決める。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00012'
    - '00017'
    - '00029'
---

## コンテキスト

Pluginエコシステムを育てるには「作る側の入口」と「使う側の運用面」をどこに置くかの方向が要る。旧実装は独自の配布・install機構（Starter kit・install layout・release管理）を整えていたが、その水準の独自機構を今回も前提とするかは別の話。

あわせて、Plugumi本体の管理面では、`plugumi` CLIとUI Appの役割を分ける必要がある。CLIはCoreと同じバイナリが提供する管理interfaceであり、UI Appは作業する場所である。どちらもCore Daemonの管理操作を呼べるが、process ownershipはCore Daemon側に置く。

## 決定

以下を採用する方向。

- **既存CLIを活用**: Pluginは対象プラットフォームのCLI拡張機構として実装できる。Plugin作者にPlugumi独自CLIへの寄せを必須にしない
- **`plugumi` CLIはCoreと同じバイナリの管理interface**: Core Daemonの起動・停止、状態確認、Plugin管理、Execution参照などを扱う。Plugin runtimeの標準的なspawn ownerにはしない
- **MVPの公式なCore Daemon起動経路は`plugumi` CLIとUI App**: OS service / autostartは後続の配布設計で扱う
- **外部サービスの認証・設定はPluginに任せる**: `gh auth login` など既存の仕組みを利用する。PluginやブラウザをCoreが認証・認可する仕組みとは別にする（[Decision 00012](00012-plugin-initiated-connections.md)）
- **Coreは単体で管理可能**: `plugumi` CLI / TUIとUI Appは、同じDaemon management APIを通してPluginや設定を管理できる。独立したManagerは必須にしない
- **Web app / Electron appは公式UI App**: installable pluginとして差し替えない。複数Coreへ接続でき、Coreのbuilt-in viewやPluginのViewを表示する
- **静的ファイルと配布形態**: Web appとElectron appの配布・bundle方法は別に決める。Electron appが`apps/web`のserverを内部componentとして再利用するかは未決定とする
- **リモート接続は隔離されたnetwork経由**: ローカル接続を基本にしつつ、CoreはTailscaleなどのoverlay networkとの統合を前提にする。Cloudflare Tunnel + Accessなども追加候補とするが、公開internetへ無認証で開く前提にはしない

## 代替案

- 独自配布CLI・レジストリの整備: 配布面の自由度は増すが、既存CLIの認証・更新・発見の仕組みを再実装するコストが大きい。旧実装が独自install機構を持っていたのとは方向が違う
- Plugumi側での認証一元管理: 秘密管理をCoreに集めると信頼モデル（`docs/decisions/00001`）以上の保証が要る
- 専用Manager GUIを必須化: UI Appの任意性と矛盾し、ローカル単体利用の入口を重くする
- UI Appを管理操作の唯一の入口にする: CLIや自動化からCore Daemonを管理しにくい。UI Appがprocess ownerになる構成とも混ざりやすい

## トレードオフと帰結

- 管理操作の正本はDaemon management APIに置き、`plugumi` CLI / TUIとUI Appはそのclientにできる
- 外部サービスの認証をPluginに委任するため、その資格情報の保管・期限切れへの対応は各Pluginの品質に依存する
- リモート接続を後付け可能としたことで、接続層の認証・暗号化は将来のcontract設計に持ち越す
- Web app / Electron appの配布方法は未決定なので、`apps/web`と`apps/electron`の実装依存を正式な配布contractと混同しない。ただしElectron appが利用するWeb app側serverは別processとして配布する方向とし、Electron app内部componentへ同梱する案は採らない

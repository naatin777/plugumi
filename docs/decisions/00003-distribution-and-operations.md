---
type: decision
title: 配布・管理・認証の置き場所
description: Pluginの配布形態・Core管理面・認証の委譲先・Hostの任意性を決める。
status: draft
relations:
  architecture:
    - '00002'
---

## コンテキスト

Pluginエコシステムを育てるには「作る側の入口」と「使う側の運用面」をどこに置くかの方向が要る。旧実装は独自の配布・install機構（Starter kit・install layout・release管理）を整えていたが、その水準の独自機構を今回も前提とするかは別の話。

## 決定

以下を採用する方向。

- **既存CLIを活用**: 対象プラットフォームのCLI拡張機構として実装できる。独自CLIは必須にしない
- **外部サービスの認証・設定はPluginに任せる**: `gh auth login` など既存の仕組みを利用する。PluginやブラウザをCoreが認証・認可する仕組みとは別にする（[Decision 00012](00012-plugin-initiated-connections.md)）。
- **Coreは単体で管理可能**: CLI/TUIでPluginや設定を管理。独立したManagerは必須にしない
- **web・electronは任意のUI Hostを提供するPlugin**: 複数Coreに接続でき、CoreのBuilt-in PanelやPluginのPanelを表示する
- **静的ファイル**: WebとElectronは別に検討する。Webの配信入口は[システム構成 00002](../architecture/00002-plugin-client-system.md)で比較し、まだ決定しない。
- **リモート接続は任意**: ローカル接続を基本に、TailscaleやCloudflare Tunnel + Accessなどを追加可能にする

## 代替案

- 独自配布CLI・レジストリの整備: 配布面の自由度は増すが、既存CLIの認証・更新・発見の仕組みを再実装するコストが大きい。旧実装が独自install機構を持っていたのとは方向が違う
- Plugumi側での認証一元管理: 秘密管理をCoreに集めると信頼モデル（`docs/decisions/00001`）以上の保証が要る
- 専用Manager GUIを必須化: Hostの任意性と矛盾し、ローカル単体利用の入口を重くする

## トレードオフと帰結

- 管理面を複数持たせず、まずCLI/TUIの単体管理を正本にできる
- 外部サービスの認証をPluginに委任するため、その資格情報の保管・期限切れへの対応は各Pluginの品質に依存する
- リモート接続を後付け可能としたことで、接続層の認証・暗号化は将来のcontract設計に持ち越す

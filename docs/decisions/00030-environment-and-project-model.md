---
type: decision
title: Environmentを前提インフラとし、Projectを環境上のfolderへの参照として扱う
description: Environment / Environment Providerの位置づけ、SSH / Tailscale経由の接続方向、Project / Area / Workspace / Panelの階層を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00017'
    - '00019'
    - '00022'
    - '00024'
  design:
    - '00004'
    - '00005'
  requirement:
    - '00003'
    - '00004'
---

## コンテキスト

`Environment` / `Environment Provider` は、filesystem、terminal、shell、process、network接続など、非常に標準的なoperationを提供するものである。挙動としてはProvider protocolを使うためPluginに似ているが、製品上は通常のinstallable pluginではない。あまりに標準的なので、Plugumiではこれが存在しない場合を基本構成として考えない。

また、Project / Area / Workspace / Panelの階層について、従来の「AreaとWorkspaceが1対1」という実装寄りの整理は、意図していた概念を表していなかった。Areaは以前Collectionと呼ばれていたもので、Workspaceをまとめる単位である。

## 決定

### Environment

- Environmentは、local machine、SSH先、WSL、containerなどの実行環境であり、filesystem、terminal、shell、process、network接続などの標準operationを提供する
- EnvironmentはPluginではない。Provider protocolを使って接続・登録されることがあっても、利用者へはPluginとして見せない
- Environmentが存在しない構成は、現時点では製品の基本構成として考えない。すべての操作がEnvironmentの存在を前提にしてよい
- CoreはEnvironmentを単なるopaqueなpluginとして扱う必要はなく、Environmentを第一級の概念として知っていてよい
- 標準的な環境操作のUIは、無理にPluginへ分けず、UI Appのbuilt-in UIとして実装してよい
- SSH経由でremote environmentを使う場合は、SSH先でremote Environmentを起動し、そのremote EnvironmentがCoreへ接続する。接続後はdocker / SSHなどのprovisioning由来に関係なく、同じremote environmentの経路へ収束させる
- CoreはTailscaleなどのoverlay networkと統合する方向を前提にする。remote accessは、公開internetへ開くのではなく、適切に隔離されたnetwork経由で行えるものとして設計する

### Project / Area / Workspace / Panel

- Projectは、Environment上のdevice / folderを指すことができる作業単位とする。少なくとも「どの環境か」と「どのfolderか」を参照できる
- ProjectはAreaをまとめる
- AreaはWorkspaceをまとめる。Areaは以前Collectionと呼ばれていたものに相当する
- WorkspaceはPanelをまとめる。Panelのtab構成や並びもWorkspaceに含まれる
- IndicatorはPanelやEmbedの特殊形ではなく、独立したPlugin viewの種類とする

## 帰結

- Environment Providerはinstallable pluginではないが、内部実装としてprovider protocolを使ってよい
- filesystem / shell / terminal / process / networkなどの標準operationを、すべての操作が暗黙に利用できる基盤として扱える
- Projectは単なるUI上のグループ名ではなく、Environmentとfolderへの参照を持つ作業単位になる
- AreaとWorkspaceの対応関係は現時点では確定しない。1つのAreaを開くとWorkspaceという領域が開き、その中にPanelがtabや分割で並ぶという理解に留め、詳細は実装時に決める
- CoreがEnvironmentを知ってよいため、Environmentの有無やremote environmentの状態をDaemon management / routing / project bindingで明示的に扱える

## 未解決の問い

- `Environment` という名前自体をこのまま使うか
- Environment、node、scope、project binding、remote-side supervisorの正確な関係
- Tailscaleなどのoverlay networkとCoreの認証・ discoveryをどこまで統合するか
- Areaが入れ子になるか、WorkspaceのURL /保存形式をどう移行するか
- Environmentが複数あるとき、Projectのfolder参照とoperation routingをどう表すか
- `daemon` / `node` / `host-session` / `ui-session` の寿命分類

## 追加の決定

- Project registry（environment refとfolderを紐づけるprojectの台帳）はCoreが持つ。folder実体へのアクセスはEnvironmentが担うが、どのprojectがあるかというレコードはCoreが管理してよい。CoreはEnvironmentを第一級概念として知ってよい方向と矛盾しない

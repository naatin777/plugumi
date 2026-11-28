---
type: decision
title: UI Appはfork前提の公式実装、operationとViewはreplaceableにする
description: Web app / Electron appをruntime plugin化せず、operationとViewの差し替えはPlugin、shell構造改造はfork / downstreamに分ける境界を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00013'
    - '00015'
    - '00028'
  requirement:
    - '00003'
    - '00004'
---

## コンテキスト

旧構成ではWebとElectronもPluginだった。しかし、利用者にとって `standard` は環境アクセス、agentはAI実行主体、web / electronは画面、browserは操作対象であり、全部をPluginと呼ぶと概念が分かりにくい。

ElectronがPluginだった理由の1つは、native browserなどのAI操作可能なToolをCoreへ登録していたからである。これはUI Appそのものをplugin化する理由ではなく、app-local operationをCoreへ登録する理由である。

また、公式UI AppにCore Daemon管理画面、tray、provider状態、Execution件数、ログ、Plugin管理などを密に統合したい。installableなUI App pluginを前提にすると、そのためのHost APIを広く安定化する必要がある。過去の関連プロジェクトではextensionという用語を使っていたが、Plugumiではinstallable packageをPluginと呼ぶ。重要なのは名称ではなく、配布単位、実行entry、寿命、権限の分離である。

## 決定

- Web app / Electron appはinstallable pluginにしない。公式UI Appとし、shell構造の大幅な改造はforkまたはdownstream hostとして扱う。
- downstream hostはCore Daemonや公開protocolを使って技術的には作れるが、公式に互換性を保証する対象にはしない。
- 公式UI AppはCore Daemon管理、tray、native integrationと密に統合してよい。ただし、process ownershipはCore Daemonへ寄せ、UI Appはmanagement APIを呼ぶcontroller / displayとする。
- Electron appはWorkbench shellを内蔵し、native browserやOS統合などのapp-local operationをCoreへ登録する。
- shell自体を拡張するentryはPluginに持たせない。shell標準機能は公式shellの `shared/` 実装へ置き、shell構造の改造はforkまたはdownstream hostで行う（[Decision 00028](00028-plugin-runtime-and-view-entries.md)）。
- PluginはPlugin runtimeとPlugin viewを持てる。UIと独立して動く処理はPlugin runtime、Panel / Embed / Widgetの描画はPlugin viewに置く。
- operationとViewの差し替えはPluginで行う。file explorerの既定実装はbuilt-in viewとし、custom explorerはresource + intentで差し替えられるようにする。file explorerはvisual workbenchの基本体験の一部であり、Plugin runtime processの起動失敗時にも基本UIを提供したいため、built-inにする。一方で、filesystem operationそのものはEnvironment Providerに置く。
- 公式と第三者の完全な対等性は目標にしない。公式のbuilt-in viewは内部統合を使ってよいが、第三者が意味のある代替を作れる公開面は用意する。
- Environment Providerは利用者へPluginと見せない。browser / agent / gitなどは公式のpluginにしてよいが、公式であることとprivilegedであることを分ける。

## 改造方法の使い分け

| 変えたいもの | 手段 |
|---|---|
| 何ができるか / operation | Plugin runtime / provider |
| それをどう見せるか / view | Plugin view |
| shellの標準機能を変える | 公式shellのshared実装またはfork |
| shellの構造自体を変える | fork / downstream host |
| Coreの意味モデルやprotocolを変える | platform fork |

View差し替えはcomponent IDの上書きで行わない。`file` / `directory` のようなresourceと、`open` / `reveal` / `edit` / `preview` のようなintentでresolutionする。`panel.replace` はPanel instanceが自分を別状態へ置き換える操作であり、resourceを開いたときにどのViewを使うかの解決とは別の仕組みである。

## 代替案

| 案 | 採らない理由 |
|---|---|
| DeepSeek Harnessのようにeverything-is-a-pluginにする | Host、Provider、View、operation、environmentの区別が分かりにくい。公式UI Appの統合感も作りにくい |
| UI App自体もinstallable pluginにする | UI App APIを大きく安定化する必要があり、trayやDaemon管理との密な統合が難しい |
| file explorerなどを単一JSファイルのパス差し替えにする | resource、intent、初期params、UI App側で必要なoperation、cleanup、contract versionを表せない |
| 公式built-inと第三者Pluginの完全な対等性を目標にする | 公式UI Appの基本体験をpublic API未整備のまま縛りすぎる。意味のある代替可能性を公開すればよい |
| すべてをforkにする | file explorerの見た目変更のような小さな改造までforkが必要になる |

## トレードオフと帰結

- shell構造を変えたい利用者はforkまたはdownstream hostになる。upstream追従の負担は利用者側へ移る。
- installableなUI App pluginを支えない代わりに、公式UI Appの起動体験とDaemon管理を密に設計できる。
- shell contribution APIはPluginへ公開しない。Execution状態や通知などのshell標準機能は、Plugin個別のshell改造としてではなく、genericな公式shell機能として設計する。
- この方針を採用する場合、[Decision 00013](00013-web-plugin-gateway.md)と[Decision 00015](00015-electron-plugin-shares-plugin-shell.md)の「Web / ElectronもPlugin」という表現と構成を再整理する必要がある。UI Appが登録するoperationの登録自体は残る。
- 再検討のきっかけ: shell標準機能として表現できない共通UI conceptが明確になり、Pluginのshell改造としてではなく公式shell機能へ昇格させる判断が必要になったとき。

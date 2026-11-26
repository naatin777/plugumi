---
type: architecture
title: Daemon中心のVisual Workbench Platform構成（検討案）
description: UI非依存のCore Daemon、Workbench Host、Environment / Capability Provider、Plugin、Host-local capabilityの境界と寿命を整理した検討案。
status: draft
relations:
  architecture:
    - '00002'
  decision:
    - '00012'
    - '00013'
    - '00014'
    - '00015'
    - '00016'
    - '00017'
    - '00018'
    - '00019'
    - '00020'
  design:
    - '00006'
    - '00008'
    - '00009'
  requirement:
    - '00003'
    - '00004'
---

## 対象範囲と位置づけ

この文書は、Plugin中心の構成を見直し、Plugumiを独立したvisual workbench protocol / platformとして再構成する方向を記録した検討案である。会話で出た論点を失わないためのドラフトであり、acceptedではない。

現行のaccepted構成は[Architecture 00002](00002-plugin-client-system.md)である。この文書は、00002および[Decision 00013](../decisions/00013-web-plugin-gateway.md)、[Decision 00015](../decisions/00015-electron-plugin-shares-plugin-shell.md)が前提とする「Web / ElectronもPlugin」という構成と矛盾する案を含む。どの範囲を正式に置き換えるかは未承認である。

## 確定に近い前提

- UIの状態はdurableな処理へ影響しない。renderer reload、Panel close、window close、UI app quitのいずれも、durableな実行中の作業を暗に停止しない。host-sessionなcapabilityは寿命を明示した例外とする。
- Electron appをquitしてもCore DaemonとExecutionは残る。これは利用者が長期間前提としてきた原則である。
- ユーザーへ見せる操作は内部実装の区別ではなく、分かりやすい単位へ寄せる。managed / self-managed / externalの区別はlifecycleとownershipを正しく実装するための内部モデルとし、不要に操作や状態表示へ露出しない。
- PlugumiはMCP Appsへ乗るものではなく、独立したvisual workbench protocol / platformを目指す。
- 「何でもPlugin」とはしない。Pluginという語を、Host、Provider、View、capability、environmentのすべてへ使わない。第一級概念はPluginではなく、Capability / Operation / Resource / Execution / Viewとして整理する。
- MCPとの差は、ToolにUIを持たせること、Panel、UIアプリ導入、Event / 可視化、HostとViewの自由度にある。

## コンポーネントと責務

| Component | 責務 | 担わないこと |
|---|---|---|
| Core Daemon | capability routing、provider registration、Execution / Event / Resource参照、managed providerのlifecycle、Daemon management API | AI推論、filesystem / browser / agentなどのdomain logic、Workbench画面 |
| Workbench Host | Web / Electronの公式UI shell。Panel layout、Viewのmount、通知、tray、Daemon管理画面、Host固有のOS統合 | installable pluginとしての差し替え、Executionの所有 |
| Environment Provider | filesystem / shell / terminal / processなどの環境標準capabilityをlocal / WSL / remote / Dockerなどへ提供する | 利用者向けの拡張機能という扱い、Coreへの内蔵 |
| Capability Provider | browser / agent / git / 外部serviceなどのcapabilityを提供する | CoreをbypassしたProvider間通信、UIの所有 |
| Plugin | capability / operation・View contributionをまとめるinstall / enable / disable / replace可能な配布単位 | Platform起動や修復そのもの |
| Host Capability Provider | Workbench Hostが内蔵するprovider roleとして、host-local capabilityをCoreへ登録する。独立したuser-facing processではない。例はElectron native browser、native dialog、OS統合 | daemon寿命の実行、UIに依存しない長時間処理 |
| View | Panel / Embedなどの人間向けUI。resourceやExecutionを表示・操作する | capabilityやruntimeの所有 |

重要なのは、**配布単位**と**実行時の役割**を分けることである。Pluginは配布単位であり、ProviderやViewはその中の役割である。Environment Providerは実装上はprovider protocolを使っても、利用者へは「Plugin」ではなく「環境」として見せる。

## Workbench Hostとforkの境界

Web / Electron Workbench Hostはruntime installableなpluginとして差し替えない。公式Hostを提供し、shell構造そのものを変えたい場合はforkまたはdownstream hostとして扱う。WebとElectronでWorkbench本体をforkせず、共通のWorkbench実装を使い、tray、native dialog、native browser presentationなどの差分はHost adapter / Host capabilityで吸収する方向を検討する。

downstream hostはCore Daemonや公開protocolを使って技術的には作れるが、公式に互換性を保証する対象ではない。安定させるのはCore protocol、capability contract、Execution model、Daemon management APIなどの公開境界であり、Workbench内部のcomponent、Layout Store、DOM構造ではない。

公式Hostはfork前提なので、Core Daemonの状態、managed provider、Execution件数、ログ、Plugin管理、trayなどと密に統合してよい。ただし、process ownershipはCore Daemonへ寄せる。ElectronやWeb UIはmanagement APIを呼ぶcontroller / displayであり、個別processを直接所有しない。

## Pluginの実行entry

Pluginは最大2種類のentryを持てる。

| Entry | 実行場所 | 寿命 | 役割 |
|---|---|---|---|
| runtime entry | Core-managedなplugin runtime host / provider process | UIと独立して長時間動く | capability提供、Operation実装、状態保持、event処理 |
| view entry | Panel / Embed内 | View instance | 画面描画とUI操作 |

browser tabやElectron rendererの中で動くview entryは、UIを閉じれば終わる。UIを閉じても動き続ける必要がある処理はruntime entryとしてCore-managed processで動かす。

Plugin packageはmanifestでcontributionとactivation eventを宣言し、必要になるまでruntime / viewのentryを起動しないようにできる。最終的なview bundleが1つのJSファイルであっても、差し替え対象はJSファイルパスではなくmanifest付きのcontributionとする。

shell自体を拡張するentryはPluginに持たせない。command、menu、status item、notificationなどのshell標準機能は公式shellの実装として `shared/` に置き、shell構造そのものを変えたい場合はforkまたはdownstream hostで対応する。Web / ElectronがPluginだった時代に想定していたClient entry / workbench entryは、[Decision 00028](../decisions/00028-plugin-runtime-and-view-entries.md)により廃止する。

## contextをAPI surfaceにする

entryごとに渡すcontextを分ける。runtime entryへはcapability / operation登録、他capabilityの呼び出し、Execution、event、storage、loggingを持つcontextを渡す。view entryへはhost element、params、panel操作、operation呼び出しなどの狭いcontextを渡す。

context上のcapability操作はCoreをbypassする裏口ではなく、Core経由のroutingとExecution記録に乗る便利APIとする。これにより、Pluginからはtyped / semanticな操作として見せつつ、Provider間の直接通信や権限回避を防ぐ。

## capabilityとViewの差し替え

capabilityの差し替えとViewの差し替えは分ける。

- filesystem / shell / terminalは環境標準capabilityのcontractとする。Coreには内蔵せず、Environment Providerが実装する。
- browserは環境標準capabilityとは別にし、公式bundleに入る既定Plugin / provider候補とする。
- file explorerの既定実装はHost bundledなViewとする。plugin systemの外で起動できる基本体験とする。
- custom file explorerはPluginのview contributionとして提供し、`file` / `directory` resourceと `open` / `reveal` などのintentでresolutionする。

公式のfile explorerはHost内部の状態やUIと密に統合してよい。公式と第三者の完全な対等性は目標にしない。ただし、第三者が意味のある代替Viewを作れるだけの公開APIは用意する。

## browserの2系統

browserは3つの責務を分ける。

1. browser automation capability。profile / page / navigate / input / closeなどの操作を提供する。
2. browser presentation。pageを画面へどう表示するかを決める。
3. browser viewer UI。人間がpageを見て操作するViewを提供する。

さらに、runtimeの寿命で2系統に分ける。

| 系統 | 実行場所 | 寿命 | 用途 |
|---|---|---|---|
| durable browser provider | Daemon管理process / remote provider | daemon / node | Agent、background execution、長時間処理 |
| native host browser provider | ElectronなどのHost内 | host-session | interactiveなnative browser |

browserとelectron-native browserで、page / profile / navigate / inputなどのoperation semanticsは可能な範囲で共通化する。一方で、runtimeの寿命とpresentationは分ける。Electron native `WebContentsView` はElectron processの寿命に依存する。したがって、真のnative埋め込みと、UI app quit後もbrowser runtimeが生きていることは両立しない。Agentやbackground executionはdurable capabilityだけにbindする。

Electronのnative browser capabilityは、Web UIやAIからCore経由で操作できる。ただし、画面のnative presentationはElectronでだけ利用できる。Webではplaceholder、stream viewer、screenshot、control-only viewなど、そのHostとProviderが対応する範囲で表示する。

## Host Capability Provider

Electronは当初Pluginだったが、その理由は「ElectronのUIをplugin化したい」だけではない。Electronがnative browserなどのAI操作可能なToolをCoreへ登録していたためである。

この事実は維持する。ただし概念は分ける。

```text
Electron app
├── Workbench Host
└── Host Capability Provider
```

Host Capability Providerは、Hostとは別のprocessや配布単位ではなく、Host process内でhost-local capabilityをCoreへ登録する役割である。Web UIやAIはElectronが接続している間、そのcapabilityをCore経由で呼べる。Electronをquitすればcapabilityはoffline / unavailableになり、host-sessionな実行は継続できない。Web Hostも同じ枠組みでbrowser clipboard、browser notification、web-native file pickerなどのhost-local capabilityを提供し得る。

## UI operationとwork operation

UIを操作するoperationと、UIに依存しない作業を進めるoperationを分ける。例えばPanelを開く、Panelをrevealする、native browserを表示するようなoperationはhost-scopedなUI operationである。一方、fileを読む、shellを実行する、durable browser pageをnavigateするようなoperationはProviderが持つwork operationである。

Agentやbackground executionは、durableなwork operationだけにbindする。host-scopedなUI operationは人間やUI連携のために存在してよいが、UIがなければ実行できない capabilityとして明示する。Host名で分岐せず、Host capabilityの有無でpresentationや操作可否を判断する。

## capabilityの寿命とrouting metadata

capabilityは、どこで・どのくらいの寿命で有効かをmetadataとして公開する。候補は `daemon`、`node`、`host-session`、`ui-session` である。Environment Providerは静的なplugin一覧ではなく、local / remote / Dockerなどのenvironmentの追加・消失に応じてregistrationとsessionが動的に変わるものとして扱う。複数のElectron hostやenvironmentがある場合は、host instance、node、project、account / profileなどのrouting情報も必要になる。これらはoperation名へ埋め込まず、invocation context、resource ref、project bindingとして扱う。providerはoperationごとに `targetAxes` や `lifetime` を宣言せず、寿命はprovider sessionからCoreが導出する。

## 寿命モデル

| もの | 寿命 |
|---|---|
| View / renderer | 表示のたびに作り直してよい |
| Panel instance | mount / unmount / virtual化できる。実行を所有しない |
| Web / Electron Host | close・quit・停止してもCoreとの通信が途切れるだけ。Executionやprovider lifecycleを所有しない |
| Host Capability Provider | Host app / sessionの寿命。HostがCoreへ登録するcapabilityであり、独立したuser-facing processではない |
| Core Daemon | Executionとmanaged provider lifecycleの所有者 |
| managed plugin runtime / provider | Core Daemonまたはその委譲先に管理される。`1 Core : 1 provider session : 1 runtime process` に割り切る |
| 外部接続provider | 自分で生きる。Coreは管理しない |

Electronの操作は `Close Window`、`Quit Desktop UI`、`Shut Down Plugumi` を分ける。`Shut Down Plugumi` だけがCore Daemonとmanaged providerを止める操作であり、実行中の作業がある場合は確認する。

## Executionを第一級概念にする

UIが実行を所有しないなら、`callId` のような接続相関IDだけでは足りない。長時間処理はCoreが管理するExecutionとして表す。

Executionは少なくとも、ID、operation、status、caller、解決済みcontext、作成・更新時刻、progress、resource refs、parent executionを持ち得る。UIはExecutionを開始・購読・一覧・cancelするが、UI connectionはExecutionを所有しない。詳細は[Decision 00016](../decisions/00016-ui-independent-execution-daemon.md)を参照。

## operation targeting

project、environment、host、service account / profileはoperationの振り分けに必要な情報である。ただしAIやcallerへ毎回入力させるstructured targetは設けず、invocation context、resource ref、project bindingからCoreが解決する。genericな `account` axisはpublic contractへ出さない。詳細は[Decision 00024](../decisions/00024-operation-invocation-context-and-execution.md)を参照。

## multi-core Plugin processとprovider ownership

managed plugin runtimeは `1 Core : 1 provider session : 1 runtime process` に割り切る。同じPluginを複数Coreでenableにした場合は、既存processへ接続を追加せず、Coreごとに独立したruntime processを起動する。これにより、incrementalなCore追加通知、process ownership、障害分離を簡単にする。

重いbrowser runtime、LLM runtime、hardware handleなどをPlugin内部で共有するかは、Plugin作者の自由である。Plugumiがmanaged lifecycleとして見るのはCoreごとのruntime processだけであり、そのprocessが全機能を持つか、既に起動しているbackend / shared runtimeへ接続する薄いadapterかをplatformは規定しない。典型的には `Coreごとのlightweight adapter + shared runtime` に分けられる。shared runtime自体がCoreへ直接接続する場合は、それはPlugin内部の私有resourceではなくself-managed / externalなmulti-core serviceとして扱う。

protocolレベルでは1つのPlugin processが複数Coreへ接続することを禁止しない。ただし、そのようなprocessはself-managed / externalなserviceとして扱い、Plugumiのmanaged runtime lifecycleでは起動・停止・接続先追加を管理しない。managedなuser-level multi-core serviceは持たない。詳細は[Decision 00019](../decisions/00019-multicore-plugin-process-ownership.md)を参照。

## Panel Referenceと仮想Panel

Hostごとに表示能力が違うため、共有するのは実行中のView実体ではなくPanel Referenceとする。各Hostはresource + intentとHost capabilityからViewを解決し、表示できない場合はunavailable panelまたはfallbackを出す。詳細は[Design 00006](../designs/00006-panel-references-virtual-panels.md)を参照。

## Embed Referenceとdeclarative surface

EmbedはA2UI-inspiredまたはA2UI-compatibleなdeclarative component treeを第一級の共通表現にする方向で検討する。component tree / data binding / actionの構成はdeclarativeに扱い、diff viewer、terminal、browser viewportなどのrich UIはcatalog登録されたcustom componentとして組み込む。JSを文字列としてevalせず、custom componentの実装はversionedなassetまたはmoduleとして参照する。

EmbedもPanelと同様に、実行中の実体ではなくEmbed Referenceを共有し、Hostごとにrepresentationを解決する。declarative surfaceをportable baseline、custom componentやnative componentをenhanced representationとし、表示可能でも必要になるまではvirtual embedにする。詳細は[Decision 00020](../decisions/00020-declarative-embed-components.md)と[Design 00008](../designs/00008-embed-references-semantic-projections.md)を参照。

## Interaction / AffordanceとExecution UI

AIはcomponent treeを読んで意味を推測しない。人間向けのcomponentとは別に、machine-facingな意味投影としてInteractionとAffordanceを持つ。Interactionは人間またはAgentの入力待ちを表し、Affordanceはresource / executionに対して現在利用できる操作を表す。componentはこれらを描画するが、capabilityの正本にはしない。

長時間のoperationは最終結果の前にrunning状態のExecutionを返し、UIは同じExecutionをinline embed、execution center / status area、panel、notificationなど複数のplacementから表示できる。低levelな子実行は記録しつつ、表示はparent executionやtaskへ集約する。詳細は[Design 00009](../designs/00009-execution-ui-placements.md)を参照。

## Workbench状態の共有

Workbench状態はHost間で共有する方向で検討する。少なくとも、WebとElectronの間でPanel Referenceや作業状態を引き継げることを前提にする。layoutの配置まで全て共有するか、配置だけHost sessionごとに持つかは未決定である。

## 用語の方向

ユーザー向けのinstall単位はPluginと呼んでよい。問題なのはPluginという語そのものではなく、Host、Provider、View、capability、environmentのすべてを同じ語で説明していたことである。Provider、View、Host、Environmentは役割として分けつつ、install単位の名称はPlugumiというproduct名と整合するPluginを優先する。Extensionという語は使わず、install単位はPluginに統一する。

## 未解決の問い

- Core Daemon、Environment Provider、Plugin runtime、self-managed / external service、Web / Electron Hostの起動・停止・再起動・所有関係をどう分けるか。process record、heartbeat、cache path、service discoveryを誰が持ち、誰が読むかを含めて整理する。managed plugin runtimeの操作面をWeb / ElectronからCLI invocationへ寄せるか、Core Daemonのprocess manager APIにするかもここで決める。
- JS系Pluginを共有plugin runtime hostで動かすか、Pluginごとにprocessを分けるか。共有hostは軽いが障害分離が弱く、per-plugin processは分離しやすいが重い。
- Daemon management APIの認証・権限分離をどこまで公開contractにするか。
- Workbench状態のうち、layoutの配置までHost間で共有するか、配置だけHost sessionごとに持つか。
- Electron native browserの映像をstreamやscreenshotでWebへ出すか。
- host-session capabilityをExecutionへどこまで紐付け、quit時にどう記録するか。
- `standard` という名前をどのタイミングでenvironment / 標準capabilityへ移行するか。
- 公式Hostの小さな改造APIとして、menu / command / status以外に何を公開するか。
- A2UI v1.0へどこまでwire compatibleにするか、Plugumi独自profileにする範囲。
- Embed Reference / surface state / Interaction / AffordanceをResource modelへどう統合するか。
- self-managed / external serviceが複数Coreへ接続するときの登録UX、credential配布、危険性表示。

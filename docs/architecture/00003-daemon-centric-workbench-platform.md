---
type: architecture
title: Daemon中心のVisual Workbench Platform構成
description: UI非依存のCore Daemon、UI App、Environment / Provider、Plugin、UI App operationの境界と寿命を定める現行構成。
status: accepted
relations:
  architecture:
    - '00002'
  decision:
    - '00012'
    - '00016'
    - '00017'
    - '00019'
    - '00020'
    - '00021'
    - '00022'
    - '00023'
    - '00024'
    - '00025'
    - '00026'
    - '00027'
    - '00028'
    - '00029'
    - '00030'
  design:
    - '00006'
    - '00008'
    - '00009'
  requirement:
    - '00003'
    - '00004'
---

## 対象範囲と位置づけ

この文書は、Plugumiの現行システム構成の正本である。[Architecture 00002](00002-plugin-client-system.md)が前提としていた「Web / ElectronもPlugin」という構成を置き換える。00002にあった接続方向や通信基盤の決定のうち現行なものは、[Decision 00012](../decisions/00012-plugin-initiated-connections.md)と[Contract 00004](../contracts/00004-plugin-client-protocol.md)が引き継ぐ。

PlugumiはMCP Appsの上に乗るものではなく、独立したvisual workbench protocol / platformを目指す。MCPとの差は、ToolにUIを持たせること、Panel、UI App導入、Event / 可視化、UI AppとViewの自由度にある。

## 基本原則

- UIの状態はdurableな処理へ影響しない。renderer reload、Panel close、window close、UI App quitのいずれも、durableな実行中の作業を暗に停止しない。
- Electron appをquitしてもCore Daemonとdurable Executionは残る。停止は明示的なExecution cancel、またはCore Daemon / managed provider全体の停止によって行う。
- host-sessionなoperationは寿命を明示した例外とする。Agentやbackground executionはdurable operationだけにbindする。
- Plugumiはoperation / Execution中心のworkbenchとする。第一級概念はPluginではなく、Operation / Resource / Execution / Viewである。
- 「何でもPlugin」とはしない。Pluginはinstallable packageの名前であり、Host、Provider、View、operation、environmentのすべてを指す語ではない。
- 配布単位と実行時の役割を分ける。Pluginは配布単位であり、ProviderやViewはその中の役割である。
- 操作面とprocess ownershipを分ける。UI AppとCLIは管理操作の入口になってよいが、操作した側がprocessの所有者になるとは限らない。
- ユーザーへ見せる操作は内部実装の区別ではなく、分かりやすい単位へ寄せる。managed / self-managed / externalの区別はlifecycleとownershipを正しく実装するための内部モデルとし、不要に操作や状態表示へ露出しない。

## コンポーネントと責務

| Component | 責務 | 担わないこと |
|---|---|---|
| Core Daemon | operation routing、provider registration、Execution / Event / Resource参照、managed provider lifecycleの制御、Daemon management API | AI推論、filesystem / browser / agentなどのdomain logic、Workbench画面 |
| plugumi CLI | Coreと同じバイナリが提供する管理interface。Core Daemonの起動・停止、状態確認、Plugin管理、Execution参照などを行う | 独立したprocess owner、Plugin runtime processの標準的な実行場所 |
| UI App | Web app / Electron app。公式UI shell、Panel layout、Viewのmount、通知、tray、Daemon管理画面、app固有のOS統合 | installable pluginとしての差し替え、Executionの所有、Plugumi管理のPlugin runtime processの直接所有 |
| Environment Provider | local / SSH先 / WSL / containerなどのEnvironmentが持つfilesystem / shell / terminal / process / network接続などの標準operationをCoreへ提供する | 利用者向けのinstallable pluginという扱い、Coreへの内蔵 |
| Provider | browser / agent / git / 外部serviceなどのoperationを提供する | CoreをbypassしたProvider間通信、UIの所有 |
| Plugin | operation・View contributionをまとめるinstall / enable / disable / replace可能な配布単位 | Platform起動や修復そのもの |
| UI App operation | UI Appがapp-local operationをCoreへ登録する。独立したuser-facing processではない。例はElectron native browser、native dialog、OS統合 | daemon寿命の実行、UIに依存しない長時間処理 |
| View | Panel / Embedなどの人間向けUI。resourceやExecutionを表示・操作する | operationやPlugin runtimeの所有 |

Environment Providerは実装上はprovider protocolを使っても、利用者へは「Plugin」ではなく「環境」として見せる。Environmentは製品の前提インフラであり、Environmentがない構成は基本構成として考えない。CoreはEnvironmentを第一級の概念として知ってよく、標準的な環境操作のUIはUI Appのbuilt-in UIとして実装してよい。UI App operationもprovider protocolを使うが、installable pluginではない。

## 起動と管理操作の入口

MVPで公式にするCore Daemonの起動入口は、`plugumi` CLIとUI Appの2つである。OSの常駐・自動起動の仕組みは後続の配布設計で扱う。起動入口が違っても、起動後のCore DaemonはUI Appから独立したprocessである。

UI AppとCLIは、どちらもDaemon management APIを通して同じ管理操作を行えるようにする。対象はCore Daemonの起動・停止、Pluginのenable / disable、Executionの参照・cancel、ログや状態の確認を含む。UI Appは作業する場所であり、CLIはCoreと同じバイナリが提供する管理interfaceである。

UI AppがCore Daemonを起動する場合も、UI Appは起動後のCore Daemonを所有しない。UI Appを閉じてもCore Daemonは残る。Electronの操作は `Close Window`、`Quit Desktop UI`、`Shut Down Plugumi` を分け、`Shut Down Plugumi` だけがCore Daemonとmanaged providerを止める操作とする。実行中の作業がある場合は確認する。

## Plugumi管理のPlugin runtime processの起動・停止

Plugumi管理のPlugin runtime processのlifecycle制御はCore Daemonが担う。ただし、Core Daemonがすべての場所で直接processをspawnするとは限らない。実際にspawnする主体は、Plugin runtime processが動く場所に合わせる。

| Plugin runtime processの場所 | 実際にspawnする主体 |
|---|---|
| Core Daemonと同じlocal machine | Core Daemonのlocal process manager |
| remote machine / container / WSL | その場所にあるsupervisor。Environment Providerまたは外部systemが担う |
| self-managed / external service | 利用者、外部system、またはそのservice自身 |

UI AppとCLIはspawn ownerではない。これらはCore Daemonへenable / disable / stopを依頼する操作面である。Core Daemonはlifecycleの制御面として状態を追跡し、必要に応じてremote-side supervisorへ起動・停止を委譲する。

Plugumi管理のPlugin runtime processは `1 Core : 1 provider session : 1 Plugin runtime process` に割り切る。同じPluginを複数Coreでenableにした場合は、既存processへCore接続を追加せず、Coreごとに独立したPlugin runtime processを起動する。重いbrowser process、LLM service、hardware handleなどをPlugin内部で共有するかはPlugin作者の自由である。Plugumiがmanaged lifecycleとして見るのはCoreごとのPlugin runtime processだけであり、そのprocessが全機能を持つか、既に起動しているPlugin内部の共有serviceへ接続する薄いadapterかをplatformは規定しない。

Plugin内部の共有service自体が複数Coreへ直接接続する場合は、Plugin内部の私有resourceではなくself-managed / externalなmulti-core serviceとして扱う。Plugumiのmanaged lifecycleでは起動・停止・接続先追加を管理しない。詳細は[Decision 00019](../decisions/00019-multicore-plugin-process-ownership.md)を参照。

## UI Appとforkの境界

Web app / Electron appはinstallable pluginとして差し替えない。公式UI Appを提供し、shell構造そのものを変えたい場合はforkまたはdownstream hostとして扱う。WebとElectronでWorkbench本体をforkせず、共通のWorkbench実装を使い、tray、native dialog、native browser presentationなどの差分はapp側のadapter / app-local operationで吸収する。

downstream hostはCore Daemonや公開protocolを使って技術的には作れるが、公式に互換性を保証する対象ではない。安定させるのはCore protocol、operation contract、Execution model、Daemon management APIなどの公開境界であり、Workbench内部のcomponent、Layout Store、DOM構造ではない。

公式UI Appはfork前提なので、Core Daemonの状態、managed provider、Execution件数、ログ、Plugin管理、trayなどと密に統合してよい。ただし、process ownershipはCore Daemonへ寄せる。ElectronやWeb UIはmanagement APIを呼ぶcontroller / displayであり、個別processを直接所有しない。

## Plugin runtimeとPlugin view

Pluginの構成概念は2つに絞る。

| 概念 | 実行場所 | 寿命 | 役割 |
|---|---|---|---|
| Plugin runtime | Core-managedなPlugin runtime process、または外部管理のPlugin service | UIと独立して長時間動いてよい | operationの提供、状態保持、event処理 |
| Plugin view | Panel / Embed / Indicator内 | View instance | 画面描画とUI操作 |

Plugin runtimeはProviderとしてCoreへ接続し、接続・登録時にPlugin manifestをPOST / PUTなどでCoreへ送る。Plugin manifestはファイルではなく、Plugin runtimeが送る宣言情報である。operation宣言、UI contribution宣言、UI bundle参照などを含む論理集合として扱い、実際のwire上は複数のREST操作へ分かれてよい。

Plugin viewはProviderとしてCoreへ接続しない。browser tabやElectron rendererの中で動き、UIを閉じれば終わる。UIを閉じても動き続ける必要がある処理はPlugin runtimeへ置く。

CoreへのWS接続、登録、reconnect、operation dispatch、UI bundle登録などの共通処理は、Plugin runtimeそのものではなく、Plugin runtimeが使うruntime support libraryの責務として分ける。Panel / Embed / Indicatorの型、context、design tokenなどの共通処理は、Plugin viewが使うview support libraryの責務として分ける。

shell自体を拡張する仕組みはPluginに持たせない。command、menu、status item、notificationなどのshell標準機能は公式shellの実装として `shared/` に置き、shell構造そのものを変えたい場合はforkまたはdownstream hostで対応する。Web / ElectronがPluginだった時代に想定していたClient entry / workbench entryは廃止する。詳細は[Decision 00028](../decisions/00028-plugin-runtime-and-view-entries.md)を参照。

## contextをAPI surfaceにする

Plugin runtimeとPlugin viewで渡すcontextを分ける。Plugin runtimeへはoperation登録、他operationの呼び出し、Execution、event、storage、loggingを持つcontextを渡す。Plugin viewへはhost element、params、panel操作、operation呼び出しなどの狭いcontextを渡す。

context上のoperation呼び出しはCoreをbypassする裏口ではなく、Core経由のroutingとExecution記録に乗る便利APIとする。これにより、Pluginからはtyped / semanticな操作として見せつつ、Provider間の直接通信や権限回避を防ぐ。

## operationとViewの差し替え

operationの差し替えとViewの差し替えは分ける。

- filesystem / shell / terminal / process / network接続はbuilt-in environment operationのcontractとする。Coreには内蔵せず、Environmentが実装し、Environment Provider経由でCoreへ提供する。
- browserはenvironmentのbuilt-in operationとは別にし、用途に応じてUI App operationまたはplugin / providerとして提供する。
- file explorerの既定実装はbuilt-in viewとする。plugin systemの外で起動できる基本体験とする。
- custom file explorerはPluginのview contributionとして提供し、`file` / `directory` resourceと `open` / `reveal` などのintentでresolutionする。

公式のfile explorerはUI App内部の状態やUIと密に統合してよい。公式と第三者の完全な対等性は目標にしない。ただし、第三者が意味のある代替Viewを作れるだけの公開APIは用意する。

## EnvironmentとProject

Environmentは、local machine、SSH先、WSL、containerなどの実行環境であり、filesystem、terminal、shell、process、network接続などの標準operationを提供する。EnvironmentはPluginではない。SSH経由でremote environmentを使う場合は、SSH先でremote Environmentを起動し、そのremote EnvironmentがCoreへ接続する。CoreはTailscaleなどのoverlay networkと統合する方向を前提にし、remote accessは公開internetではなく隔離されたnetwork経由で行えるものとして設計する。

Projectは、Environment上のdevice / folderを指すことができる作業単位である。少なくとも「どの環境か」と「どのfolderか」を参照できる。画面の概念階層は Project > Area > Workspace > Panel とし、ProjectはAreaを、AreaはWorkspaceを、WorkspaceはPanelとそのtab構成をまとめる。詳細は[Decision 00030](../decisions/00030-environment-and-project-model.md)を参照。

## browserの2系統

browserは3つの責務を分ける。

1. browser automation operation。profile / page / navigate / input / closeなどの操作を提供する。
2. browser presentation。pageを画面へどう表示するかを決める。
3. browser viewer UI。人間がpageを見て操作するViewを提供する。

さらに、browserを動かすprocessの寿命で2系統に分ける。

| 系統 | 実行場所 | 寿命 | 用途 |
|---|---|---|---|
| durable browser provider | Daemon管理process / remote provider | daemon / node | Agent、background execution、長時間処理 |
| native host browser provider | ElectronなどのUI App内 | host-session | interactiveなnative browser |

browserとelectron-native browserで、page / profile / navigate / inputなどのoperation semanticsは可能な範囲で共通化する。一方で、browser processの寿命とpresentationは分ける。Electron native `WebContentsView` はElectron processの寿命に依存する。したがって、真のnative埋め込みと、UI App quit後もbrowser runtimeが生きていることは両立しない。Agentやbackground executionはdurable operationだけにbindする。

Electronのnative browser operationは、Web UIやAIからCore経由で操作できる。ただし、画面のnative presentationはElectronでだけ利用できる。Webではplaceholder、stream viewer、screenshot、control-only viewなど、そのUI AppとProviderが対応する範囲で表示する。

## UI App operation

ElectronがPluginだった理由の1つは、native browserなどのAI操作可能なToolをCoreへ登録していたからである。この事実は維持するが、概念は分ける。

```text
Electron app（UI App）
├── Workbench shell
└── app-local operation implementations
```

UI App operationは、UI App process内のapp-local operationをCoreへ登録したものである。別processや配布単位ではない。Web UIやAIはElectronが接続している間、そのoperationをCore経由で呼べる。Electronをquitすればoperationはoffline / unavailableになり、host-sessionな実行は継続できない。Web appも同じ枠組みでbrowser clipboard、browser notification、web-native file pickerなどのapp-local operationを提供し得る。

## UI operationとwork operation

UIを操作するoperationと、UIに依存しない作業を進めるoperationを分ける。例えばPanelを開く、Panelをrevealする、native browserを表示するようなoperationはhost-scopedなUI operationである。一方、fileを読む、shellを実行する、durable browser pageをnavigateするようなoperationはProviderが持つwork operationである。

Agentやbackground executionは、durableなwork operationだけにbindする。host-scopedなUI operationは人間やUI連携のために存在してよいが、UIがなければ実行できないoperationとして明示する。UI App名で分岐せず、UI App operationの有無でpresentationや操作可否を判断する。

## operation / providerの利用可能期間とrouting metadata

operationは、どこで・どのくらいの期間利用できるかをmetadataとして公開してよい。候補は `daemon`、`node`、`host-session`、`ui-session` である。Environment Providerは静的なplugin一覧ではなく、local / remote / Dockerなどのenvironmentの追加・消失に応じてregistrationとsessionが動的に変わるものとして扱う。複数のElectron appやenvironmentがある場合は、host instance、node、project、account / profileなどのrouting情報も必要になる。これらはoperation名へ埋め込まず、invocation context、resource ref、project bindingとして扱う。providerはoperationごとに `targetAxes` や `lifetime` を宣言せず、寿命はprovider sessionからCoreが導出する。

## 寿命モデル

| もの | 寿命 |
|---|---|
| View / renderer | 表示のたびに作り直してよい |
| Panel instance | mount / unmount / virtual化できる。実行を所有しない |
| Web app / Electron app | close・quit・停止してもCoreとの通信が途切れるだけ。Executionやprovider lifecycleを所有しない |
| UI App operation | UI App / sessionの寿命。UI AppがCoreへ登録するoperationであり、独立したuser-facing processではない |
| Core Daemon | Executionとmanaged provider lifecycleの所有者 |
| Plugumi管理のPlugin runtime process / provider | Core Daemonがlifecycleを制御し、実行場所に応じたspawn主体が起動する。`1 Core : 1 provider session : 1 Plugin runtime process` に割り切る |
| 外部接続provider | 自分で生きる。Coreは管理しない |

## Executionを第一級概念にする

UIが実行を所有しないなら、`callId` のような接続相関IDだけでは足りない。長時間処理はCoreが管理するExecutionとして表す。

Executionは少なくとも、ID、operation、status、caller、解決済みcontext、作成・更新時刻、progress、resource refs、parent executionを持ち得る。UIはExecutionを開始・購読・一覧・cancelするが、UI connectionはExecutionを所有しない。詳細は[Decision 00016](../decisions/00016-ui-independent-execution-daemon.md)を参照。

## operation targeting

project、environment、host、service account / profileはoperationの振り分けに必要な情報である。ただしAIやcallerへ毎回入力させるstructured targetは設けず、invocation context、resource ref、project bindingからCoreが解決する。genericな `account` axisはpublic contractへ出さない。詳細は[Decision 00024](../decisions/00024-operation-invocation-context-and-execution.md)を参照。

## Panel Referenceと仮想Panel

UI Appごとに表示能力が違うため、共有するのは実行中のView実体ではなくPanel Referenceとする。各UI Appはresource + intentとappが利用できるoperationや表示機能からViewを解決し、表示できない場合はunavailable panelまたはfallbackを出す。詳細は[Design 00006](../designs/00006-panel-references-virtual-panels.md)を参照。

## Embed Referenceとdeclarative surface

EmbedはA2UI-inspiredまたはA2UI-compatibleなdeclarative component treeを第一級の共通表現にする方向で検討する。component tree / data binding / actionの構成はdeclarativeに扱い、diff viewer、terminal、browser viewportなどのrich UIはcatalog登録されたcustom componentとして組み込む。JSを文字列としてevalせず、custom componentの実装はversionedなassetまたはmoduleとして参照する。

EmbedもPanelと同様に、実行中の実体ではなくEmbed Referenceを共有し、UI Appごとにrepresentationを解決する。declarative surfaceをportable baseline、custom componentやnative componentをenhanced representationとし、表示可能でも必要になるまではvirtual embedにする。詳細は[Decision 00020](../decisions/00020-declarative-embed-components.md)と[Design 00008](../designs/00008-embed-references-semantic-projections.md)を参照。

## Interaction / AffordanceとExecution UI

AIはcomponent treeを読んで意味を推測しない。人間向けのcomponentとは別に、machine-facingな意味投影としてInteractionとAffordanceを持つ。Interactionは人間またはAgentの入力待ちを表し、Affordanceはresource / executionに対して現在利用できる操作を表す。componentはこれらを描画するが、operationの正本にはしない。

長時間のoperationは最終結果の前にrunning状態のExecutionを返し、UIは同じExecutionをinline embed、execution center / status area、panel、notificationなど複数のplacementから表示できる。低levelな子実行は記録しつつ、表示はparent executionやtaskへ集約する。詳細は[Design 00009](../designs/00009-execution-ui-placements.md)を参照。

## Workbench状態の共有

Workbench状態はUI App間で共有する方向で検討する。少なくとも、WebとElectronの間でPanel Referenceや作業状態を引き継げることを前提にする。layoutの配置まで全て共有するか、配置だけUI App sessionごとに持つかは未決定である。

## リポジトリ構成との対応

概念とリポジトリの主な対応は次の通り。

| ディレクトリ | 対応する概念 |
|---|---|
| `core/` | Core Daemonと`plugumi` CLI |
| `apps/web/` | Web app。browser向けのserver / frontendを含む現行実装 |
| `apps/electron/` | Electron app |
| `environment/` | Environment Provider |
| `plugins/` | installable Pluginの実装。現行はagentなど |
| `packages/` | 汎用library / SDK / protocol補助実装 |
| `shared/` | first-party component間で共有する実装。Workbench shellを含む |

`packages/` と `shared/` は公開予定で分けない。詳細は[Decision 00026](../decisions/00026-packages-and-shared-directory-boundary.md)を参照。

## 用語の方向

ユーザー向けのinstall単位はPluginと呼ぶ。Provider、View、UI App、Environmentは役割として分ける。Extensionという語は使わず、install単位はPluginに統一する。公式UIはUI Appと呼び、個別にはWeb app / Electron appと呼ぶ。利用者が追加installせずに使える基本体験はbuilt-inと呼ぶ。

## 未解決の問い

- process record、heartbeat、cache path、service discoveryを誰が持ち、誰が読むか。起動・停止の制御面はCore Daemonに決めたが、状態共有のwire contractとfile layoutは未決定である。
- JS系Pluginを1つのNode processへまとめて載せるか、Pluginごとにprocessを分けるか。共有processは軽いが障害分離が弱く、per-plugin processは分離しやすいが重い。
- Daemon management APIの認証・権限分離をどこまで公開contractにするか。
- Electron appが利用するWeb app側serverの配布物の形。serverは別processとして配布する方針だが、install物・更新方法・バージョン整合は未決定である。
- Workbench状態のうち、layoutの配置までUI App間で共有するか、配置だけUI App sessionごとに持つか。
- Electron native browserの映像をstreamやscreenshotでWebへ出すか。
- host-session operationをExecutionへどこまで紐付け、quit時にどう記録するか。
- `Environment` という名前自体をどうするか。
- 公式UI Appの小さな改造APIとして、menu / command / status以外に何を公開するか。
- A2UI v1.0へどこまでwire compatibleにするか、Plugumi独自profileにする範囲。
- Embed Reference / surface state / Interaction / AffordanceをResource modelへどう統合するか。
- self-managed / external serviceが複数Coreへ接続するときの登録UX、credential配布、危険性表示。
- `packages/` に置くTypeScript / Node.js向けCore client / provider libraryの名前と分割。

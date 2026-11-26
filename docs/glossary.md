# 用語集

Plugumiドキュメントで使う用語の正本。一般的な技術用語ではなく、**Plugumi独自の概念・使い分け**を記録する。新しい概念が生まれたらここに追加し、他のドキュメントはこの定義に従う。

各用語は `###` 見出しにしてあり、他のドキュメントから `glossary.md#<term>` の形で参照できる（例: `glossary.md#link`）。

## 構成要素

### Core

中央の仲介プロセス（`core/`、Go実装）。新方式ではHTTPの接続先となり、Plugin登録・通知・RPC配送を担う。個々のアプリケーションの機能ロジックは持たない。

### Plugin

capability / operationやViewなどのcontributionを束ねるinstallable package。公式・第三者のいずれにもなり得るが、UI App / Environment / Core builtin capabilityはPluginではない。Pluginはruntime entryとview entryを持てる。runtime entryは利用者が指定したCoreへ自ら接続する。

### Environment Provider

ファイルシステムやプロセス実行など、実行環境のcapabilityをoperationとして提供するProvider（`environment/`、Rust実装）。installable packageとして配布されるPluginとは区別し、登録時の`providerKind`は`environment`を使う。

### UI Host

現行実装と旧docsを読むための用語。Plugin Viewsの実行・配信環境。Coreと接続し、環境固有の機能を担う役割。
Web PluginやElectron Pluginが提供する。operation実行やPluginプロセス自体の寿命を管理しない。

### Web Plugin

現行実装と旧docsを読むための用語。ブラウザ向けのUIを提供するPlugin（`apps/web/`）。他のPluginと同じく、指定されたCoreへ自ら接続・登録する。ブラウザ向けのHTTPサーバーを持ち、ブラウザとCoreの間を仲介する。1つのプロセスが複数のCoreに接続できる（[Decision 00013](decisions/00013-web-plugin-gateway.md)）。capability-centric modelではPluginではなくUI Appとして扱う。

### Plugin Views

Panel・Embed・Indicator等を表示するための共通インターフェース（仕様）。
実行環境ではなく、実行はUI Appが担う。アセットの配信主体は構成によって異なる。

### Plugin View

Pluginが提供する、画面にはめ込まれるUIの1つ1つ（Panel・Embed・Indicator）。作者向けの型とTokenの名前は、配布用のパッケージ `@plugumi/plugin-view`（`packages/plugin-view`）にある。

### Plugin Shell

Plugin Viewを並べて表示する画面の外枠。UI Hostの役割を担うWeb PluginとElectron Pluginが共有する（`shared/workbench`、リポジトリの中だけで使う）。Plugin Shellは `ShellHost` というinterfaceを通してだけ外とやりとりし、Web PluginとElectron Pluginがそれぞれ実装する。Tokenの値はPlugin Shellが持つ。capability-centric modelでは、これをinstallable pluginの仕組みではなく `shared/workbench` の公式shell共有実装として扱う。

### Panel

UI App上に表示されるPlugin提供のView。新方式ではCore仲介RPCを操作通信の第一候補とし、Panel専用APIはoperationと分ける。Web Pluginは、Panelを隔離せずに自身の画面で動かす（[Decision 00014](decisions/00014-panel-runs-unisolated.md)）。

### UI Bundle

Panel等を表示するためのビルド成果物。entrypointのほか、JS・CSS・画像・フォント・分割chunkなどの相対パス付きアセットを含む。Pluginはファイルごとに内容のsha256を付けてCoreへ送り、Coreが配信する（[Contract 00004](contracts/00004-plugin-client-protocol.md)）。

## 接続・実行モデル

### Registration

特定のCoreにおけるPluginインスタンスの論理的な登録。登録の識別子は `registrationId`。物理接続から独立した寿命を持つ（[接続契約](contracts/00004-plugin-client-protocol.md)）。

### Lease

期限内の更新を条件にRegistrationを維持する仕組み。永続登録や通信路そのものとは異なる。

### Revision

Registryの観測時点を表す版。SSE通知とSnapshotの照合に使う。クライアントが連番やCore間での比較を仮定しない。

### Node

Pluginが宣言する「実行環境」の共有識別（ローカル・Docker・リモートPC等）。Coreは意味を解釈しない。

### Core名

Coreに任意で付ける名前（`plugumi.json` の `core.name` または `--name`）。`coreId` はプロセスごとに変わるが、Core名は再起動しても変わらない。Web PluginはURLでCoreを指すときにCore名を使う。

## 旧v1の接続用語

以下のLink、transport、caller channelは、[置き換え前のv1契約](contracts/00001-core-plugin-transport.md)を指す場合の定義。

### Link

CoreとPluginが確立する1つの接続・登録単位。`POST /v1/link/hello` で始まり、transport切断または失効で終わる。`linkId` で識別。Tool呼び出しの宛先でもある。

### linkId

Core発行の一意ID。同一Plugin実装の複数接続（複数Core・複数Endpoint等）を区別するため実装IDとは別に持つ。MVPではlink-scoped。

### Transport

Linkと1対1で結ばれた双方向通信路（WebSocket + JSON-RPC 2.0）。CoreがPluginへ接続を開始し、`tools.call` 系（呼び出し・途中出力・終端・中断）だけがこの1本を流れる。登録・検査系はPlugin RESTで行う。transportの寿命とLinkの寿命は一致する。

### caller channel

Coreがcaller（Tool呼び出し元）向けに開くWebSocket接続（`GET /v1/call`、`docs/contracts/00001`）。Linkには紐付かず、connの寿命=接続の寿命。Pluginでないcaller（TUI・UI Host・スクリプト）は自身のtransportを持たないため、このchannel上で `docs/contracts/00003` のcaller側プロトコルをそのまま喋る。Transportとは別物。

## 画面の階層

Web Pluginの画面は Core > Project > Area > Workspace の順に入れ子になる。Coreより下の階層の状態はWeb Pluginのサーバーが保存し、Coreは扱わない（[Design 00004](designs/00004-web-plugin-screen-hierarchy.md)）。

### Project

Coreの中で扱う1つのプロジェクト。Coreが組織にあたるのに対し、Projectは組織の中の仕事の単位にあたる。

### Area

Projectのうち、どの部分を扱うかの単位。worktree、monorepo内のpackage、同じプロジェクトの別repositoryなど、種類の異なるものを同じ階層で扱う。Areaは入れ子にでき、フォルダのようなツリーになる。Areaごとに1つのWorkspaceを持つ。

### Workspace

Areaの中でファイルを見るなどの作業をする画面。Areaと1対1に対応し、Panelの配置先としてcenterのsplit treeだけを持つ。固定されたleft・bottom・rightの領域はなく、「縁に常設する」配置は利用者がtreeの端にleafを作って表現する。

### Dock

旧画面モデルでPanelを置いていた固定領域（left・bottom・center・right）。現行モデルでは固定Dockを持たず、Workspaceはcenterのsplit treeだけを持つ。旧ドキュメントを読むときの用語として残している。

## 旧revisionのTool用語

以下のTool、toolPath、Discovery、Tool Call、kindは、改訂前の `registrationId + toolPath` modelを読む場合の定義。新しいdocsではoperation / Executionの用語を使う。現行実装は移行前のため、実装読解ではこの旧用語が残る。

### Tool

Pluginが呼び出し元へ公開する機能単位。対象Core内のPlugin登録と `toolPath` で厳格に指定した。Panel専用操作はToolとは別に扱う。

### toolPath

登録内で一意なTool識別子。operation pathへ一本化した新しいmodelでは使わない。

### Tag

Toolに設定する検索用ラベル。

### Discovery

Tag・Schema等でTool候補を検索する仕組み。結果は対象Core内のPlugin登録と `toolPath` の組を基本とした。

### Tool Call（invoke）

Toolの実行呼び出し。呼び出し元はPluginに限らず、Coreが指定された対象Pluginへ仲介した。wireの形態はプロトコル版の契約で定義する。

### callId

呼び出しに紐付くメッセージの相関キー。識別子の有効範囲はプロトコル版の契約で定義する。永続的な実行IDを意味しない。

### kind

旧revisionのTool宣言に付ける形態ラベル（`sync` / `async`）。operation / Execution modelでは使わない。

### Queue

Agent等への入力の待ち受け機構（priority/timing付き）。Plugin内部都合でありCore契約の外（`docs/decisions/00002`）。

### Subscribe（購読）

変更を継続的に受け取ること。旧v1では長時間の `kind: async` callを指す場合がある。現行契約のRegistry購読はSSEで行う。

## capability-centric modelの用語

以下は[Architecture 00003](architecture/00003-daemon-centric-workbench-platform.md)、[Decision 00024](decisions/00024-operation-invocation-context-and-execution.md)、改訂後の[Contract 00004](contracts/00004-plugin-client-protocol.md)で使う用語である。実装は移行中だが、新しいdocsではこちらの用語を使う。

### Provider

capability / operationをCoreへ登録し、実行を受け付ける側。Environment Provider、UI App capabilityの実装、Pluginのruntime entryなどを含む。`registrationId` はCore内部の登録・配送管理IDであり、callerがoperation invocationの宛先として指定するものではない。

### Operation

Providerが公開するsemanticな操作単位。`filesystem/list` のようなoperation pathで識別し、callerも同じpathで呼ぶ。Toolとoperationを別名で持たない。

### operation path

Operationのcanonicalな識別子。slash区切りpathとし、CLI・MCP・HTTP API・AI tool catalogで共通に使う。slashを扱えない外部実装向けのencode/decodeはadapterだけで行う。

### operation invocation

Operationの実行呼び出し。callerはoperation pathとoperation inputを指定し、project / account / hostなどのrouting情報はinvocation context、resource ref、project bindingからCoreが解決する。AIへ見せるtool schemaにはoperation inputだけを含める。

### invocation context

operation inputとは別に、routingと記録のためにCoreが解決・付与する実行文脈。project、caller execution、host sessionなどを含み得る。AIに毎回入力させる項目ではない。

### Core Daemon

UI Appの寿命から独立して動くCore。Execution、capability routing、provider lifecycleを管理する。検討案では、Electron appをquitしてもCore Daemonとdurable Executionは残る。

### UI App

Web app / Electron appとして提供される公式UIアプリ。Workbench shell、Panel layout、Viewのmount、通知、tray、Daemon管理画面などを担う。runtime installableなpluginとして差し替えず、構造改造はforkまたはdownstream hostとして扱う。

### Environment Provider

filesystem / shell / terminal / processなどのbuilt-in environment capabilityを、local / WSL / remote / Dockerなどの環境へ提供するProvider。利用者へはPluginではなく環境として見せる方向で検討している。

### UI App capability

UI AppがCoreへ登録するapp-local capability。例はElectron native browser、native dialog、OS統合、browser clipboard、web-native file picker。installable pluginではなく、寿命は原則としてhost-sessionであり、durable executionの対象にはしない。内部実装ではprovider protocolを使うが、独立した第一級概念としては扱わない。

### built-in

利用者が追加installしなくても製品の基本体験として最初から使えるもの。実装場所を意味しない。`標準装備` / `標準搭載` という語は使わない。

### runtime entry

Pluginのうち、UIと独立して長時間動くentry。Core-managedなplugin runtime processまたはprovider processで実行し、capability提供、operation実装、状態保持、event処理を行う。transport上はCoreへのWebSocket clientとして振る舞うことがあるが、概念名としてはWS clientと呼ばない。

### view entry

Pluginのうち、Panel / Embed内で描画とUI操作を担うentry。View instanceと同じ寿命を持つ。shell自体を拡張するentryはPluginに持たせない。

### Execution

Core Daemonが管理する実行の単位。UI connectionやPanelの寿命から独立し、状態・途中出力・結果参照・cancelの対象になる。すべてのoperation invocationはExecutionとして記録し、`callId` のような接続相関IDとは区別する。fastなoperationは最初からterminal状態のExecutionになる。

### Capability

操作・Resource・Event・寿命の意味を持つ機能単位。実装はProviderが持ち、CoreはroutingとExecution記録を担う。`filesystem` / `shell` / `browser` などの意味名で扱い、`standard` / `electron` のような実装名と混同しない方向で検討している。

### Panel Reference

共有・保存できるPanelへの参照。resource、intent、preferred view、params、寿命などを持ち、実行中のView実体ではない。各Hostが自分のcapabilityに従ってViewへ解決する。

### virtual panel

Panel instanceとして存在するが、view runtimeをまだmountしていないinertな状態。DOM、event listener、timer、background処理を持たない。

### unavailable panel

現在のHostでは表示できないが、Panel Referenceとして存在する状態。`unsupported`、`missing-view`、`runtime-unavailable`、`fallback-available` などの理由を区別する。


### self-managed / external Plugin service

1つのprocessが複数Coreへ接続し得る、Plugumiのmanaged runtime lifecycleで管理しないPlugin service。起動・停止・接続先Coreの追加は、利用者、外部system、またはそのservice自身が管理する。managed plugin runtimeは `1 Core : 1 provider session : 1 runtime process` に割り切る。

### desired session state

self-managed / externalなmulti-core serviceが利用し得る、「どのCoreへ接続してほしいか」を表す状態。Plugumiの標準managed lifecycleには採用しない。人間が直接編集する設定ファイルとは区別し、runtime statusやdiscovery stateと混ぜない。

### reconciliation

desired stateと実際の状態を比較し、冪等な処理で実際の状態をdesired stateへ近づける繰り返し可能な制御。file watch eventだけに依存せず、full scanと定期的な再確認を含める。

### Embed Reference

共有・保存できるEmbedへの参照。resource、intent、representation、寿命などを持ち、実行中のcomponentやDOM実体ではない。各Hostが自分のcapabilityとimplementation registryに従ってrepresentationへ解決する。

### virtual embed

Embedとして存在するが、まだmountしていないinertな状態。DOM、event listener、timer、background処理を持たない。表示可能であることと、実際にmountしていることを区別する。

### declarative surface

component tree、data binding、actionをJSONなどの宣言的な形式で表すEmbedの表現。A2UI-inspiredまたはA2UI-compatibleな方向で検討している。portable baselineとして扱う。

### Component Catalog

declarative surfaceで利用できるcomponentとfunctionの集合。basic component、standard component、plugin custom componentを含み得る。componentの組み合わせは動的でも、implementationは登録済みのものを使う。

### custom component

catalogに登録されたcomponentのうち、JSやnative実装を持つrich component。diff viewer、terminal、browser viewportなどが例。declarative surfaceの外にある対立概念ではなく、compositionの中のleafとして扱う。

### Interaction

人間またはAgentの入力を待っている第一級の対象。状態、対象resource、入力schema、利用可能なactionを持ち、component treeとは別にAIやWorkbench shellが参照できる。

### Affordance

resource / executionに対して現在利用できる操作。operationが存在することと、現在の状態や権限で有効であることを区別する。componentはAffordanceを描画するが、capabilityの正本にはしない。

### Execution View

同じExecutionを表示するview。inline embed、execution center / status area、panel、notificationなど複数のplacementがあり得る。viewを閉じてもExecution自体は残る。

## Specbook・文書

### Specbook

本ドキュメント体系の形式。8つのartifact type + frontmatter + relationsで構成する。

### artifact

`docs/<type>/NNNNN-*.md` の1ファイル。typeごとのフォルダでIDを持つ。

### relation

frontmatterの `relations` キーで表す外向きリンク。キーは参照先type名。

## 方針メモ

- 人間とAIが同じJSONや表示を理解する必要はない。「共通の意味を持つ操作・情報へ、それぞれに適した方法でアクセスできる」が本質（`docs/goals/00001`）
- 「自分で作れる」はGoalではなく信頼の境界の根拠（`docs/decisions/00001`）

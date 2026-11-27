# 用語集

Plugumiドキュメントで使う用語の正本。一般的な技術用語ではなく、**Plugumi独自の概念・使い分け**を記録する。新しい概念が生まれたらここに追加し、他のドキュメントはこの定義に従う。

各用語は `###` 見出しにしてあり、他のドキュメントから `glossary.md#<term>` の形で参照できる（例: `glossary.md#link`）。

## 構成要素

### Core Daemon

UI Appの寿命から独立して動く中央process（`core/`、Go実装）。operation routing、provider registration、Execution / Event / Resource参照、managed provider lifecycleの制御、Daemon management APIを担う。個々のアプリケーションの機能ロジックは持たない。単にCoreと書く場合も、文脈がprocessや接続先を指す限り同じものを指す。

### plugumi CLI

Coreと同じ `plugumi` バイナリが提供する管理interface。Core Daemonの起動・停止、状態確認、Plugin管理、Execution参照などを行う。TUIもこのCLI側の操作面に含める。Plugin runtimeの標準的なspawn ownerではない。

### UI App

Web app / Electron appとして提供される公式UIアプリ。Workbench shell、Panel layout、Viewのmount、通知、tray、Daemon管理画面などを担う。installable pluginとして差し替えず、構造改造はforkまたはdownstream hostとして扱う。ExecutionやPlugumi管理のPlugin runtime processを所有しない。

### Web app

ブラウザ向けのUI App（`apps/web/`）。ブラウザ向けのHTTPサーバーとfrontendを持ち、ブラウザとCoreの間を仲介する。1つのprocessが複数のCoreへ接続できる。

### Electron app

Electron向けのUI App（`apps/electron/`）。Web appとWorkbench shellを共有しつつ、native browser、window操作、OS統合などのapp-local operationをCoreへ登録できる。

### Environment

local machine、SSH先、WSL、containerなどの実行環境。filesystem、terminal、shell、process、network接続などの標準operationを提供し、Plugumiの操作はEnvironmentの存在を前提にしてよい。Pluginではない。

### Environment Provider

Environmentの標準operationをCoreへ提供するProvider（`environment/`、Rust実装）。利用者へはPluginではなく環境として見せる。SSH経由ではSSH先でremote Environmentを起動し、そのremote EnvironmentがCoreへ接続する。登録時の`providerKind`は`environment`を使う。

### Provider

operationをCoreへ登録し、実行を受け付けるinteraction上の役割。componentの分類ではない。Plugin runtime、Environment Provider、UI App、AI agent runtimeなどがこの役割を演じ得る。Provider間はCoreをbypassして通信しない。

### Plugin

operationやViewなどのcontributionを束ねるinstallable package。公式・第三者のいずれにもなり得るが、UI App / Environment Provider / Core built-in機能はPluginではない。PluginはPlugin runtimeとPlugin viewを持てる。

### built-in

利用者が追加installしなくても製品の基本体験として最初から使えるもの。実装場所を意味しない。`標準装備` / `標準搭載` という語は使わない。

### View

Panel / Embedなどの人間向けUI。resourceやExecutionを表示・操作する。operationやPlugin runtimeの所有とは分ける。

### Panel

UI App上に表示されるView。Core仲介RPCを操作通信の第一候補とし、Panel専用APIはoperationと分ける。現行のWeb appはPanelを隔離せずに自身の画面で動かす（[Decision 00014](decisions/00014-panel-runs-unisolated.md)）。

### Widget

旧称Widget。状態表示やshortcutを担う独立したPlugin viewの種類。PanelやEmbedの特殊形ではない。常時見せるライブなmicro surfaceで、pluginが供給し自己更新する。status barへの固定配置と、widget panel内への自由配置の両方を許す。例はCPU / memory使用量、AI使用量、実行中件数、panel shortcut。詳細は[Design 00010](designs/00010-panel-embed-widget-view-types.md)を参照。

### Plugin view

Pluginが提供する、画面にはめ込まれるUI部分（Panel・Embed・Widget）。UI App / Workbench shellにmountされ、ProviderとしてCoreへ接続しない。作者向けの型とTokenの名前は、現行では `@plugumi/plugin-view`（`packages/plugin-view`）にある。

### Workbench shell

Plugin viewを並べて表示する画面の外枠。Web appとElectron appが共有する公式shell実装（`shared/workbench`）であり、installable pluginではない。`ShellHost` interfaceを通して外とやりとりし、Tokenの値を持つ。

### UI Bundle

Panel等を表示するためのビルド成果物。entrypointのほか、JS・CSS・画像・フォント・分割chunkなどの相対パス付きアセットを含む。Pluginはファイルごとに内容のsha256を付けてCoreへ送り、Coreが配信する（[Contract 00004](contracts/00004-plugin-client-protocol.md)）。

## operation / Executionモデル

### caller / provider

operation invocationにおける役割。callerはoperationを呼ぶ側、providerはoperationをCoreへ登録して実行を受け付ける側。どちらもcomponentの分類ではなくinteractionごとの役割であり、1つのcomponentは両方を同時に演じ得る。例えばAI agent runtimeは、fs / terminalのoperationを呼ぶcallerであると同時に、自分自身を `agent/message/send` のようなoperationとして登録するproviderにもなり得る。呼び出しは常にCore経由で、provider間を直接接続しない。`registrationId` はCore内部の登録・配送管理IDであり、callerがoperation invocationの宛先として指定するものではない。

### capability（廃止語）

旧検討ではoperation pathのまとまりや機能領域をcapabilityと呼んでいたが、概念が曖昧なため現行の正式用語としては使わない。必要な場合は「機能領域」「operation group」などと普通に説明し、Coreの登録単位や第一級Objectにはしない。

### Operation

Providerが公開するsemanticな操作単位。`filesystem/list` のようなoperation pathで識別し、callerも同じpathで呼ぶ。中核概念はoperationであり、toolはoperationのcaller向け投影として区別する。

### tool

operationをcaller向けに投影したもの。AI SDK、MCP、function callingなどの適配層で使う語であり、Coreの登録対象やwire上の概念ではない。1つのoperationを用途やcallerごとに複数のtoolとして露出しうる。toolにはinput bind（引数の固定・隠蔽・既定値）や露出制御が乗りうるため、AIに見せるschemaとproviderへ実際に送るinputは一致しないことがある。現時点では第一級概念にせず、用語の使い分けだけを決める。Core、contract、routing、Executionの文脈ではoperationを使い、toolと混ぜない。

### operation path

Operationのcanonicalな識別子。slash区切りpathとし、CLI・MCP・HTTP API・AI tool catalogで共通に使う。slashを扱えない外部実装向けのencode/decodeはadapterだけで行う。

### operation invocation

Operationの実行呼び出し。callerはoperation pathとoperation inputを指定し、project / account / hostなどのrouting情報はinvocation context、resource ref、project bindingからCoreが解決する。AIへ見せるtool schemaにはoperation inputだけを含める。

### invocation context

operation inputとは別に、routingと記録のためにCoreが解決・付与する実行文脈。project、caller execution、host sessionなどを含み得る。AIに毎回入力させる項目ではない。

### Execution

Core Daemonが管理する実行の単位。UI connectionやPanelの寿命から独立し、状態・途中出力・結果参照・cancelの対象になる。すべてのoperation invocationはExecutionとして記録し、`callId` のような接続相関IDとは区別する。fastなoperationは最初からterminal状態のExecutionになる。

### operation schema

operation宣言に付く入力・出力の型情報。`inputSchema`（呼び出し引数）、`acceptSchema`（受理・開始時のoperation固有データ）、`streamSchema`（実行中のchunk / progress / log）、`resultSchema`（最終結果）を分ける。曖昧な`outputSchema`は使わない。

### binding

operationの部分適用としての設定。inputの一部をfixedまたはdefaultとして埋め、ユーザー全体 / project / agent session / 呼び出し時のレイヤーで重ねる。routing系と挙動系を分けない。fixedはcallerからの上書きを許さず、hiddenなfixedはschemaにも現れない。権限委譲（attenuation）と一体の概念でもある。詳細は[Decision 00034](decisions/00034-binding-instance-configuration-and-provider-sessions.md)を参照。

### provider session

providerがCoreへ登録・接続している1つのsession。processとは分離し、1つのPlugin runtime processが設定の異なる複数のprovider sessionを登録できる。accountのような差はinputではなくinstance configurationとしてsessionごとに持つ。

### Resource

複数のoperation invocationをまたいで参照され得る、状態を持つ対象。terminal、browser page、agent sessionなどが候補。厳密な適用範囲は未決定であり、操作対象なら何でもResourceと呼ぶわけではない。

### resource ref

Resource本体を指すwire上の参照。`terminal/123`、`browser/page/123`など。Resource本体をCoreが所有・管理することを意味しない。input / outputに含めてよく、routingの手掛かりにもなり得る。

### Resource registry

CoreがResourceの一覧や所属先を管理する仕組み。導入するかは未決定。Resourceという概念を使うことと、CoreがResource registryを持つことは別。

### Plugin runtime

Pluginのうち、画面ではない側で動く部分。operationの提供、状態保持、event処理、agent loopなどを担う。ProviderとしてCoreへ接続し、接続・登録時にPlugin manifestを送る。UIを閉じても動き続けてよい。

### Plugin manifest

Plugin runtimeがCoreへ接続・登録するときにPOST / PUTなどで送る宣言情報。ファイルではない。operation宣言、UI contribution宣言、UI bundle参照などを含む論理集合であり、実際のwire上は複数のREST操作へ分かれてよい。

### Plugin runtime process

Plugin runtimeが実際に動いているOS process。Processの起動・停止・再起動を話すときは、Plugin runtimeではなくこの語を使う。

### Plugumi管理のPlugin runtime process

Core Daemonがlifecycleを制御するPlugin runtime process。実際にspawnする主体は実行場所に応じる。Coreから見える単位は `1 Core : 1 provider session : 1 Plugin runtime process` とする。Plugin内部の共有serviceへ接続するかはPlugin作者の自由である。

### self-managed / external Plugin service

1つのprocessが複数Coreへ接続し得る、Plugumiのmanaged lifecycleで管理しないPlugin service。起動・停止・接続先Coreの追加は、利用者、外部system、またはそのservice自身が管理する。

## 接続・登録モデル

### Registration

特定のCoreにおけるProviderインスタンスの論理的な登録。登録の識別子は `registrationId`。物理接続から独立した寿命を持つ（[接続契約](contracts/00004-plugin-client-protocol.md)）。

### Lease

期限内の更新を条件にRegistrationを維持する仕組み。永続登録や通信路そのものとは異なる。

### Revision

Registryの観測時点を表す版。SSE通知とSnapshotの照合に使う。クライアントが連番やCore間での比較を仮定しない。

### Node

Providerが属する実行場所の共有識別（ローカル・Docker・リモートPC等）。Coreは意味を解釈しない。

### Core名

Coreに任意で付ける名前（`plugumi.json` の `core.name` または `--name`）。`coreId` はプロセスごとに変わるが、Core名は再起動しても変わらない。Web appはURLでCoreを指すときにCore名を使う。

### desired session state

self-managed / externalなmulti-core serviceが利用し得る、「どのCoreへ接続してほしいか」を表す状態。Plugumiの標準managed lifecycleには採用しない。人間が直接編集する設定ファイルとは区別し、process状態やdiscovery stateと混ぜない。

### reconciliation

desired stateと実際の状態を比較し、冪等な処理で実際の状態をdesired stateへ近づける繰り返し可能な制御。file watch eventだけに依存せず、full scanと定期的な再確認を含める。

## 画面の階層

画面の概念階層は Core > Project > Area > Workspace > Panel とする。ProjectはAreaを、AreaはWorkspaceを、WorkspaceはPanelとそのtab構成をまとめる。Coreより下の階層の状態は現行実装ではWeb appのサーバーが保存し、Coreは扱わない（[Design 00004](designs/00004-web-plugin-screen-hierarchy.md)）。Workbench状態をどこまでCoreやUI App間で共有するかは移行中の論点である。

### Project

Environment上のdevice / folderを指すことができる作業単位。少なくとも「どの環境か」と「どのfolderか」を参照できる。ProjectはAreaをまとめる。

### Area

Workspaceをまとめる単位。以前Collectionと呼ばれていたものに相当する。worktree、monorepo内のpackage、同じプロジェクトの別repositoryなどを扱う候補があるが、Areaが入れ子になるかは未決定。AreaとWorkspaceの対応関係も現時点では確定しない。

### Workspace

Panelとそのtab構成・並びをまとめる作業画面。Panelの配置先としてcenterのsplit treeだけを持つ。固定されたleft・bottom・rightの領域はなく、「縁に常設する」配置は利用者がtreeの端にleafを作って表現する。

### Dock

旧画面モデルでPanelを置いていた固定領域（left・bottom・center・right）。現行モデルでは固定Dockを持たず、Workspaceはcenterのsplit treeだけを持つ。旧ドキュメントを読むときの用語として残している。

## View参照とEmbed

### Panel Reference

共有・保存できるPanelへの参照。resource、intent、preferred view、params、寿命などを持ち、実行中のView実体ではない。各UI Appが自分の表示機能と利用できるoperationに従ってViewへ解決する。

### virtual panel

Panel instanceとして存在するが、Plugin viewをまだmountしていないinertな状態。DOM、event listener、timer、background処理を持たない。

### unavailable panel

現在のUI Appでは表示できないが、Panel Referenceとして存在する状態。`unsupported`、`missing-view`、`runtime-unavailable`、`fallback-available` などの理由を区別する。

### Embed Reference

共有・保存できるEmbedへの参照。resource、intent、representation、寿命などを持ち、実行中のcomponentやDOM実体ではない。各UI Appが自分の表示機能とimplementation registryに従ってrepresentationへ解決する。

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

resource / executionに対して現在利用できる操作。operationが存在することと、現在の状態や権限で有効であることを区別する。componentはAffordanceを描画するが、operationの正本にはしない。

### Execution View

同じExecutionを表示するview。inline embed、execution center / status area、panel、notificationなど複数のplacementがあり得る。viewを閉じてもExecution自体は残る。

## 旧アーキテクチャの用語

以下は旧docsまたは移行前の実装を読むための用語である。新しいdocsでは使わない。

### UI Host

旧構成でPlugin Viewsの実行・配信環境を指した語。現行ではUI Appを使う。UI Hostが担っていたapp-local operationはUI Appが登録するoperationとして分ける。

### Web Plugin

旧構成でブラウザ向けUIを提供するPluginとしていたもの。現行ではWeb appと呼び、Pluginではなく公式UI Appとして扱う。

### Electron Plugin

旧構成でElectron向けUIを提供するPluginとしていたもの。現行ではElectron appと呼び、Pluginではなく公式UI Appとして扱う。

### Plugin Shell

旧構成でWeb PluginとElectron Pluginが共有するとしていた画面の外枠。現行ではWorkbench shellと呼び、installable pluginの仕組みではなく `shared/workbench` の公式shell共有実装として扱う。

### Plugin Views

旧構成でPanel・Embed・Widget等を表示する共通インターフェースをまとめて指した語。現行ではViewまたはPlugin Viewと書き分ける。

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

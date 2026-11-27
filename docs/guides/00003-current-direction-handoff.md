---
type: guide
title: 現在の設計方向の引き継ぎ
description: UI App、built-in、Plugin、runtime lifecycle、packages/sharedに関する直近の決定と未決事項を次の作業者へ引き継ぐ。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00012'
    - '00016'
    - '00019'
    - '00021'
    - '00022'
    - '00024'
    - '00025'
    - '00026'
    - '00027'
    - '00028'
    - '00029'
    - '00030'
    - '00031'
    - '00032'
    - '00033'
    - '00034'
---

## 目的

この文書は、用語と構成について直近で決まった方向を短く引き継ぐためのものである。正本は各decision / architecture / contractであり、この文書は入口と要約に留める。

## まず読むもの

1. [Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md) — 現行のシステム構成の正本
2. [Decision 00029](../decisions/00029-ui-app-and-built-in-terminology.md) — UI App / built-inの命名と、分類語を増やさない方針
3. [Decision 00022](../decisions/00022-built-in-plugin-boundary.md) — built-inとPluginの境界
4. [Decision 00028](../decisions/00028-plugin-runtime-and-view-entries.md) — PluginはPlugin runtime / Plugin viewの2つ
5. [Decision 00019](../decisions/00019-multicore-plugin-process-ownership.md) — Plugumi管理のPlugin runtime processは1 Coreごとに1 process
6. [Decision 00024](../decisions/00024-operation-invocation-context-and-execution.md)と[Contract 00004](../contracts/00004-plugin-client-protocol.md) — operation invocation / Executionの方向
7. [Decision 00030](../decisions/00030-environment-and-project-model.md) — Environmentの前提インフラ化、Project / Area / Workspace / Panelの階層
8. [Decision 00031](../decisions/00031-operation-schemas-streams-and-routing.md) — operation schema、stream、Resource / bindの整理
9. [Decision 00032](../decisions/00032-routing-and-provider-lifecycle-notes.md) — routingとprovider / UI App停止時の整理
10. [Decision 00033](../decisions/00033-retire-capability-terminology.md) — capability / capability-centricを現行用語から外す
11. [Decision 00034](../decisions/00034-binding-instance-configuration-and-provider-sessions.md) — bindingを部分適用として扱い、account差はinstance configurationとする
12. [Design 00010](../designs/00010-panel-embed-widget-view-types.md) — Panel / Embed / Widgetのview typeとlifecycle
13. [Design 00003](../designs/00003-plugin-client-migration.md) — `toolPath` / `tools.call` の現行実装からoperation / Executionへの移行順

## 確定済みの軸

- [Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md)を現行構成の正本とする。旧[Architecture 00002](../architecture/00002-plugin-client-system.md)はdeprecatedであり、「Web / ElectronもPlugin」とする記述は現行モデルに使わない
- UIは実行を所有しない。renderer reload、Panel close、window close、UI App quitのいずれも、durableな実行中の作業を暗に停止しない（[Decision 00016](../decisions/00016-ui-independent-execution-daemon.md)）
- ProviderはCoreへ接続する。CoreがProvider側の待受へ接続する旧方式には戻らない（[Decision 00012](../decisions/00012-plugin-initiated-connections.md)）
- Plugumi管理のPlugin runtime processは `1 Core : 1 provider session : 1 Plugin runtime process` とする。Plugin内部で共有serviceを持つかはPlugin作者の自由だが、CoreからはCoreごとのprocessとして見える（[Decision 00019](../decisions/00019-multicore-plugin-process-ownership.md)）
- Plugumi管理のPlugin runtime processのlifecycle制御はCore Daemonが担う。UI Appと`plugumi` CLIは操作面であり、Plugin runtime processの直接所有者ではない
- 実際にspawnする主体はPlugin runtime processが動く場所に応じる。localではCore Daemonのlocal process manager、remote / container / WSLではその場所のsupervisor、self-managed / externalでは利用者または外部systemが担う
- `plugumi` CLIはCoreと同じバイナリが提供する管理interfaceである。Core Daemonの起動・停止、状態確認、Plugin管理、Execution参照を扱う。UI Appも同じ管理操作をDaemon management API経由で行えるようにする。MVPで公式にするCore Daemon起動経路は`plugumi` CLIとUI Appの2つで、OS service / autostartは後回し

## 用語の最新方向

- Web / Electronの公式UIは **UI App**。個別には **Web app** / **Electron app**
- `App` 単独や `Workbench Host` は正式名にしない
- `標準装備` / `標準搭載` は使わず、**built-in** を使う
- `built-in` は実装場所ではなく、追加installなしで使える製品の基本体験を指す
- `first-class` / `baseline` / `bundled` / `official plugin` / `bundled plugin` / `built-in plugin` は現段階では正式な分類語にしない。必要なら普通の日本語で説明する
- installable packageは **Plugin**。Extensionという語は現行概念として使わない
- Pluginの構成概念は **Plugin runtime** と **Plugin view** だけ。client entry / workbench entryは廃止。`entry` は基本概念にしない
- Plugin manifestはファイルではなく、Plugin runtimeが接続・登録時にPOST / PUTなどでCoreへ送る宣言情報。operation宣言、UI contribution宣言、UI bundle参照などを含む論理集合とする
- `Host Provider` は独立した第一級概念として扱わない。UI Appはapp-local operationをCoreへ登録できるが、専用の概念名はつけない。内部実装ではprovider protocolを使ってよい
- 旧 `UI Host` / `Web Plugin` / `Electron Plugin` / `Plugin Shell` は、それぞれ `UI App` / `Web app` / `Electron app` / `Workbench shell` に対応する旧称として読む。新しい文章では旧称を使わない

## 構造の最新方向

```text
Core Daemon
plugumi CLI / TUI
UI App（Web app / Electron app）
Environment Provider
Plugin
```

重要な区別:

- Environment Providerはprovider protocolを使うがPluginではない
- UI Appのoperation登録にもprovider protocolを使うがPluginではない
- provider protocolを使うことと、Pluginであることは別の話である
- UI Appはpluginではない。shell構造の大幅な改造はfork / downstream host側の話にする
- UI AppとCLIは操作面であり、process ownershipはCore Daemon側に寄せる

## リポジトリ構成との対応

| ディレクトリ | 対応する概念 |
|---|---|
| `core/` | Core Daemonと`plugumi` CLI |
| `apps/web/` | Web app。browser向けのserver / frontendを含む現行実装 |
| `apps/electron/` | Electron app |
| `environment/` | Environment Provider |
| `plugins/` | installable Pluginの実装。現行はagentなど |
| `packages/` | 汎用library / SDK / protocol補助実装 |
| `shared/` | first-party component間で共有する実装。Workbench shellを含む |

`packages/` は汎用library / SDK / protocol補助実装。`shared/` はfirst-party component間で共有する実装。公開予定で分けない（[Decision 00026](../decisions/00026-packages-and-shared-directory-boundary.md)）。

## UI /実装の最新方向

- 公式UI実装はSolidへ統一する。Panel / View protocol自体はframework非依存のままにする（[Decision 00025](../decisions/00025-official-ui-framework-solid.md)）
- Electron Site PanelはSvelteからSolidへ移行済み
- `packages/plugin-client` はlegacy。責務が混ざっているため、operation / Execution移行の中で新しいTypeScript / Node.js向けlibraryへ分解し、最終的には消す方向（[Decision 00027](../decisions/00027-client-library-languages-and-framework-bindings.md)）
- `@plugumi/plugin-view` はいったん残すが、UI lifecycleそのものの所有者はWorkbench shellであり、plugin-viewは作者向けcontract / helper / type / design tokenに寄せたい

## Environmentと画面階層の最新方向

- Environmentはlocal machine、SSH先、WSL、containerなどの実行環境で、filesystem / terminal / shell / process / network接続などの標準operationを提供する
- EnvironmentはPluginではない。Provider protocolを使っても、利用者へはPluginとして見せない
- Environmentがない構成は製品の基本構成として考えない。CoreはEnvironmentを知ってよく、標準的な環境操作UIはUI Appのbuilt-in UIに入れてよい
- CoreはTailscaleなどのoverlay networkとの統合を前提にする。公開internetへ無認証で開く前提にはしない
- ProjectはEnvironment上のdevice / folderを指す作業単位
- 画面階層は Project > Area > Workspace > Panel。ProjectはAreaを、AreaはWorkspaceを、WorkspaceはPanelとtab構成をまとめる。AreaとWorkspaceの対応関係の詳細は実装時に決める
- Widgetは独立したPlugin viewの種類

## built-in / pluginの現時点の帰属

- terminal — built-in。PTYはenvironment、viewはplatform
- file explorer — built-in view
- DiffViewer — built-in。git意味には依存しない
- Electron browser automation — Electron appのbuilt-in operation
- filesystem / shell / terminal / process / network接続 — built-in environment operation。Environmentが実装し、Environment Provider経由でCoreへ提供する
- git — built-inにしない。plugin寄り
- docker / ssh remote provisioning — plugin。SSH経由ではSSH先でremote Environmentを起動し、そのremote EnvironmentがCoreへ接続する。接続後はremote environmentへの共通経路に収束する
- AI agent — 一旦built-inにしない。pluginとして扱い、MVP検証後に見直す

## 今回解消した主な矛盾

- `Architecture 00002` がacceptedで`00003`がdraftという逆転を解消し、00003をaccepted、0002をdeprecatedにした
- `PluginがCoreへ接続する` decisionを、現行用語では`ProviderがCoreへ接続する`として読み替えた。接続方向の決定は変えていない
- `Web Plugin` / `Electron Plugin` / `Plugin Shell` の語を、現行概念では `Web app` / `Electron app` / `Workbench shell` へ揃えた
- `plugumi` CLIを「Pluginを手動起動する別仕組み」ではなく、Coreと同じバイナリの管理interfaceとして定義した
- Plugumi管理のPlugin runtime processのspawn ownerを「UI / CLI / Coreのどれか一つ」ではなく、lifecycle制御と実際のspawn主体に分けて整理した
- [Decision 00018](../decisions/00018-operation-targeting-context.md)のstructured target object案は[Decision 00024](../decisions/00024-operation-invocation-context-and-execution.md)に置き換えられたため、00018をdeprecatedにした

## operation / Executionの最新方向

- `sync / async` 種別はwire contract上は廃止し、すべてのoperation invocationはExecutionとする。速いoperationは最初からterminal状態になる。ただしAI / Code Mode / CLI向けには`immediate` / `execution` / `subscription`のようなcaller向けprofileをschemaの有無から推測して使う。これは保証ではなくwrapperや型生成のためのmetadata
- schemaは `inputSchema` / `acceptSchema` / `streamSchema` / `resultSchema` に分ける。曖昧な`outputSchema`は使わない
- 終了フラグは持たず、statusで表す
- Eventは独立した第一級概念にせず、実行中の出力はExecutionのstream outputとして扱う
- 購読や継続出力も、まず終わらない長時間Executionとして扱う方向で考える
- capability / capability-centricは正式用語として使わない。機能領域やoperation groupと普通に説明し、中心語はoperation / Execution / resource ref / providerに寄せる
- bindingはoperationの部分適用。fixed / defaultとvisibilityは直交し、ユーザー全体 / project / agent session / 呼び出し時の4層で重ねる
- accountなどのinstance差はinputではなくinstance configuration。1 processが複数provider sessionを登録できる
- discovery（account list等）は普通のoperation。AI向けtool表面はbinding適用後の姿に最小化する
- Project registryはCoreが持つ。folder実体へのアクセスはEnvironmentが担う
- 利用可能期間は独立したmetadataにせず、provider sessionのscopeから導出する
- caller / providerはcomponent分類ではなくinteractionごとの役割。AI agentなどは両方を同時に演じ得る
- Panel / Embed / Widgetはライフサイクルで分かれる。embedは記録、widgetは現在、panelは作業の主体。tool outputはresult（AI向け）とpresentation（embed向け）を別フィールドで分け、presentationはembedのdata modelへ流し込む
- provider切断時のin-flight Executionはfailedとし、error kindでexecutionFailed / providerDisconnectedを区別する。unknown statusは追加しない
- declarative surfaceのpayload仕様はA2UIを採用する方向。`@a2ui/web_core`を再利用し、rendererはSolidJS用の薄いbindingを自前で書く。transportはPlugumi独自のものを使い、AG-UIは採用しない
- Panel / Embed / WidgetはすべてJS実装の完成品componentで、違いはライフサイクルと置き場所だけ。A2UIで組み立てたdeclarativeな内容物はsurfaceと呼び、view typeとは直交する。catalogはA2UI basicをそのまま使い、custom componentを追加登録する
- tool outputはresult（AI向け）とpresentation（表示向け）を別フィールドで分け、presentationはdata modelへ流し込む。embed componentが紐付かないtool呼び出しは汎用fallback表示でよい。画面の操作手段はoperation呼び出しに紐付けられる
- Operationは旧toolPathの後継で、Plugin内部IDではなくcallerから見えるcanonicalな操作名
- Resource本体、resource ref、Resource registryは分けて考える。Resourceという概念を使っても、Coreが全Resourceを管理するとは限らない
- bindは少なくとも接続・振り分けbind、Project bind、Input bindに分けて考える

## 未決・注意

- `Environment` という名前自体はまだ納得していない。ただしEnvironmentがPluginではなく、製品の前提インフラであることは決まっている
- `daemon` / `node` / `host-session` / `ui-session` の寿命分類は、用語としても概念としても詰め切れていない
- Resourceを「複数のoperationをまたぐ状態物」に狭めるか、CoreがResource registry / routing indexを持つかは未決定
- 複数の同じPlugin / providerが登録されたとき、Coreがどこまでrouting責任を持つかは未決定。1つのPlugin runtime内で複数account / projectを扱う方式との使い分けも未決定
- Project registryをCoreが持つか、別provider / pluginが持つかは未決定
- Plugumi管理 / 外部管理 / self-managed / external serviceの整理は途中で、用語としても確定していない
- `Provider` をユーザー向け概念として使うのか、contract / implementation向けの役割名に留めるのかは未決定
- UI Appが登録するoperationには専用の概念名をつけない方針。`providerKind` enumは廃止し、scope / 利用可能期間を個別metadataで登録する方向。wire変更のタイミングはcontract revisionで決める
- `Interaction` / `Affordance` はAI向けUIの検討用語として出ているが、概念としては詰め切れていない
- 過去の議論で`Workspace`はworktree / 作業ディレクトリの意味でも使われていたが、現行ではPanelとtab構成をまとめる単位。作業ディレクトリ側の語は今後分ける必要がある
- `packages/` に置くTS向けCore client / provider libraryの名前と分割は未決定
- `shared/` の境界、特に `shared/workbench` とhost固有実装、environment panelの置き場は詰め切れていない
- process record、heartbeat、cache path、service discoveryを誰が持ち、誰が読むかは未決定
- JS系Pluginを1つのNode processへまとめて載せるか、Pluginごとにprocessを分けるかは未決定
- Daemon management APIの認証・権限分離をどこまで公開contractにするかは未決定
- Electron appが利用するWeb app側serverは別processとして配布・起動する。install物の粒度、更新方法、バージョン整合は未決定
- Workbench状態のうち、layoutの配置までUI App間で共有するかは未決定
- host-session operationをExecutionへどこまで紐付け、quit時にどう記録するかは未決定
- wire field / enumの `providerKind: "host"`、`hostSession`、`host-session` は現行contract revisionでは改名しない。改名するならcontract revisionの変更として扱う
- `official` と `bundled` の区別は、実際に外部配布やplugin配布を設計するときまで持ち越す。今は用語を増やさない
- 多くのdecisionはまだdraft。acceptedへ上げるときは内容ごとに確認し、歴史記述まで機械的に消さないこと
- [Design 00003](../designs/00003-plugin-client-migration.md)の移行順は検討案であり、実装着手の承認ではない。実装より先に概念・lifecycle・contractの議論を続ける

## 検証

docsのlink / frontmatter / relationは、少なくともこの引き継ぎ作成時点では簡易チェック済み。実装側の確認は変更範囲に応じて次を使う。

```sh
pnpm --filter plugumi-electron-ui build
pnpm --filter plugumi-electron typecheck
git diff --check
```

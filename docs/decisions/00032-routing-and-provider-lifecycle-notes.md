---
type: decision
title: operation routingとprovider / UI App停止時の扱いを整理する
description: resource refやcontextによるCore routing、複数同種providerの振り分け、UI App close / quit、provider / Core再起動時の挙動に関する検討メモ。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00024'
    - '00030'
    - '00031'
---

## コンテキスト

複数の同じPlugin / providerが同じoperationを提供する場合、Coreがどこまで振り分けるかが未決定だった。また、UI Appのwindow closeとprocess quit、Environment / Plugin runtime / Coreの停止で何が残るかも曖昧だった。

## 現在の方向

### routing

複数providerが同じoperationを提供する場合、Coreはresource refやinvocation contextを見て振り分け先を解決してよい。この振り分けをroutingと呼ぶ。account / environment / projectなどの差をoperation pathへ直接埋め込む方法ではなく、context / resource ref / bindingからCoreが解決する方法を優先して検討する。

routingするoperationと、routingを必要としないoperationは分けて考える。Resourceは必須の第一級registryではなくてもよいが、resource refやcontextがroutingの手掛かりになる場合は有用である。

複数の同種providerがある場合、少なくとも次を区別する。

- 複数provider sessionをCoreがcontext / binding / resource refからroutingする
- 1つのPlugin runtimeが内部で複数account / projectを処理し、Coreは特別なroutingをしない

曖昧な場合はCoreが適当に選ばず、ambiguous errorまたはchooserへ戻す方向を維持する。

### Projectの所有者

ProjectはEnvironmentへアクセスできればCoreが管理してもよい。CoreがEnvironmentを知ってよい方向になったため、Project registryを必ず外部pluginへ置く必要はない。ただしCore / Environment /別providerのどこが正本を持つかはまだ確定しない。

### UI Appの停止

UI Appのwindow /画面が閉じても、durableなExecutionやUI Appに属さないoperationや処理は動き続ける。一方、UI App process自体が終了すれば、そのUI Appに属するoperationは利用できなくなり、呼び出しはerrorになる。UI App process終了を理由に、Core、Environment、Plugin runtime、他のUI App、進行中のExecution全体を止めない。

### provider / Coreの停止

EnvironmentやPlugin runtimeが落ちた場合、そのproviderが提供するoperationは利用できなくなり、呼び出しはerrorになり得る。Coreが再起動した場合、現行の登録と実行参照は基本的に失われる。永続化や復帰は別途設計する。AI agentなどの処理が外部で残っていても、Core再起動後のtool callは失敗し得る。

## 追加の整理

### operation pathをURL queryのように使わない

operation pathそのものにaccountやprojectをquery / paramのように埋め込む方法は、catalog、schema、permission、AI tool名を不安定にしやすい。canonicalなoperation名は `github/issue/create` のような意味名に留め、routing情報はinput、context、resource ref、bindingから解決する。CLIやURLなどの表記上はquery風のadapterを用意してよいが、core contractのoperation pathには埋め込まない。

一方、resource refは `terminal/123`、`project/plugumi` のような階層的な参照でよい。resource refはroutingの手掛かりになり得るが、その場合もCoreは全Resource registryではなく、routingに必要なownership metadataだけを必要とする。

### capabilityという語

capability / capability-centricは現行の正式用語として使わない。`filesystem`、`terminal`などのoperation pathのまとまりを説明したい場合も、capabilityと名付けず普通に機能領域やoperation groupと説明する。contractやimplementationの中心語はoperation / Execution / resource ref / providerに寄せる。

### UI Appと実行の独立性

UIの表示状態は、Core、Environment、Plugin runtime、AI agent、他のPluginの処理へ影響しない。Web appではbrowser tabを閉じても、Electron appではwindowを閉じても、処理は継続する。UI App processが生きている間は、UI App operationも非表示状態で利用できてよい。ただし、window / pageに依存するoperationは、非表示時に維持できるかをoperationごとに決める必要がある。

UI App processが終了した場合は、そのUI Appが提供していたoperationへの新規呼び出しは利用不能errorになる。実行中だったExecutionもrunningのまま残さず、`failed` / `cancelled` / `unknown` などへ遷移させる必要がある。これはUIの表示状態が実行を止める例外ではなく、operationの実装主体であるprocessが失われたためである。

### Core再起動

Coreはできるだけstateless / fast recoveryを目指す。Providerは再起動後に再登録し、新しいoperation invocationはすぐ使えるようにする。ただし、Core再起動中だったin-flight Executionの継続は保証しない。実行そのものが外部で残っていても、CoreがexecutionIdや配送状態を失えばCoreからは追跡不能であり、`unknown`またはorphanとして扱う。

Coreは副作用のあるoperationを自動retryしない。retryするかはcaller / agent runtimeのpolicyとし、将来的な冪等性keyやExecution復帰は別途設計する。

### errorの種類

少なくとも次を区別する必要がある。

- operation invocationを作る前の失敗。未知operation、曖昧なrouting、context解決失敗、認可失敗、input不正など
- provider / operationが現在利用できない失敗。UI App process終了、Environment切断、Plugin runtime停止など
- Execution作成後の失敗。provider timeout、cancel、実行内部の失敗、追跡不能による`unknown`

AIやcallerには、単なる`error`ではなく、retry可能な一時失敗、別provider /別方法を選ぶべき利用不能、caller inputの修正が必要な失敗を区別できる情報を返す必要がある。

## 未解決の問い

- routingを必要とするoperation / providerをどう宣言または推測するか
- app session寿命のoperationとwindow / page寿命のoperationをどう区別するか
- in-flight Executionを`failed` / `cancelled` / `unknown`のどれにするかの規則
- Core再起動後のorphan Executionやresource refをどこまで復帰可能にするか
- account / environment / projectをpathへ入れず、どこまでcontext / resource ref / bindingで解決できるか
- Project registryの正本をCore、Environment、別providerのどこに置くか
- UI App process quit時のin-flight Executionを `failed` / `cancelled` / `unknown` のどれにするか
- Environment / Plugin runtime / Core再起動後に、どこまでExecutionやresource refを復帰可能にするか
- AI agentをbuilt-inにするかofficial pluginにするか。現時点ではofficial plugin寄りだが未確定

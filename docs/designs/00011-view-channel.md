---
type: design
title: View channel — plugin runtimeと自分のviewの私的通信路
description: operationとは別種別の通信として、plugin runtimeと自分のPanel / Embed / Widgetの間のprivate channelを定める。opaque payload、ライフサイクル、host operationとの使い分けを定める検討案。
status: draft
relations:
  requirement:
    - '00004'
  architecture:
    - '00003'
  design:
    - '00010'
---

## 背景

Panel / Embed / WidgetはJSで実装された完成品componentであり、多くの場合、自分を提供したplugin runtimeと通信する必要がある。chat panelならユーザーの入力をruntimeへ送り、widgetならruntimeから状態更新を受け取る。この通信をどう設計するかが論点だった。

安易な答えは「全部operationで呼べばいい」だが、これは成立しない。operationとこの通信は**公開するかどうかの違いではなく、種別が違う**。

## operationとview channelは別の通信種別

```text
operation:    pluginA ↔ Core ↔ pluginB（cross-plugin、capabilityの公開面）
view channel: pluginA ↔ Core ↔ pluginAの自分のview（intra-plugin、私的な対話）
```

種別が違うと言える机制的な根拠は3つある。

1. **Execution記録**: operation invocationは全てExecutionとして記録される。typing indicatorやscroll同期のような高頻度のUI内部通信をoperationで行うと、Execution一覧がノイズで埋まる。「記録されること」はoperationの意味論そのものなので、記録されるべきでない通信はoperationではない。
2. **catalog汚染**: operationは `operations.list` のcatalogに出る。これはAIのtool schemaの元なので、view内部の通信endpointが混ざるのは明確に害である。
3. **routingと認可**: operationはcross-pluginなので、context解決・ambiguous判定・認可が要る。view channelのroutingは自明で、view instanceは生成時点でどのregistrationのviewか決まっている。認可も「同じpluginか」の機械的照合だけでよい。

## view channelの定義

view channelは、**plugin runtimeとそのpluginのview instanceの間の、instance単位の双方向private channel**である。

- **payloadはopaque**。Coreは中身を解釈しない。messageのmethod宣言もschemaもなく、中身のプロトコルはpluginの私物である。
- **経路**: viewはUI Appやshellの仲介なしに、**自分でCoreにWS接続する**。Coreはenvelopeのroutingだけを行う。shell bridgeによる通信仲介は廃止する — shellは信頼境界ではない（[Decision 00014](../decisions/00014-panel-runs-unisolated.md)）ので仲介にセキュリティ上の意味はなく、高頻度通信がhost processを回るボトルネックだけが残る。shellの役割はvisual mounting（ShadowRootの用意、entryのimport、接続情報の受け渡し）に縮小する。
- **instance idはhostが発行する**。panelを開くとき、widgetを配置するときにhostがmintし、channelの宛先識別に使う。同じpanel typeが複数開かれてもinstance idで区別できる。
- **双方向**。view → runtime（ユーザーの操作）とruntime → view（状態のpush）の両方がある。runtime → viewのpushはwidgetのlive更新の生命線である。

## lifecycle

channelはview側から開く。view instanceのmount時にopenし、最初のmessage（またはopen handshake）でruntimeはviewの存在を知る。closeはviewのunmount・host側の終了・切断で閉じ、**runtimeはcloseを知れる必要がある**（session状態のcleanupのため）。

runtimeが能動的にviewへchannelを開く逆方向は持たない。widgetの更新pushが必要な場合でも、widget instance自体はhostが作りview側からchannelを開くので、開かれたchannel上でpushすれば足りる。

## embedの扱い

embedは「記録」なので、runtimeが死んだ後でも開ける必要がある。その場合channelは繋がらず、virtual embed / 静的表示にdegradeする。これは既存のunavailable panel / virtual embedの設計と整合する。

## UI interactionの分類とpanel.callの廃止

UIへの働きかけは全て次のどちらかに分類する。

- **capabilityとして意味があるもの** → operation。他のcallerやAIから呼べる価値があるもの（例: chatへのmessage送信、file treeを開く）。
- **viewとruntimeの私的な対話** → view channel。UI内部状態、高頻度の相互作用、instance固有のsession的やり取り。

Contract 00004に候補としてあった `panel.call`（外部からpanelの宣言methodを呼ぶ仕組み）は廃止する。cross-pluginでUIへ働きかけたい場合はcapabilityなのでoperationで足り、plugin runtimeと自分のviewの対話はview channelで足りる。VS Codeにも外部からwebviewのmethodを直接呼ぶ仕組みはなく、この分類で不足はない。

runtimeから「panelを開いてほしい」などのhostへの要求は、view channelではなく**hostがproviderとして公開するoperation**で表現する（`host-session`所属のoperation。UI Appがproviderにもなれる既存モデルにそのまま載る）。新しい仕組みは要らない。

## schema / codegenは持たない

view channelの両端は同じ作者・同じパッケージである。runtimeもviewもTypeScriptなら、sharedなtypeをimportするだけでdriftしないsingle source of truthが無料で手に入る。runtimeが別言語（Rustなど）の場合でも、私的プロトコルなのでquicktype・protobufなどplugin作者が自由に道具を選べばよく、Plugumiがschema機構を提供する必然性はない。payloadをopaqueにした設計の核心とも矛盾する。

一方で、全pluginが再発明するパターンはclient libraryが助ける。schemaではなく、TypeScriptのgenericsによる薄い型付けと、request / response相関（idを振って応答を対応付ける機構）である。詳細はclient libraryの設計で扱う。

なおoperationは公開契約なので、`inputSchema` / `resultSchema` からの型生成は別の論題として意味がある。view channelとは混ぜない。

## 接続のbinding — host事前登録 + ticket（決定）

viewがWSで繋いできたとき、Coreはroutingのためにその接続がどのinstanceかを特定する必要がある。viewの自己申告ではなく、**hostが事前登録しCore発行のticketでviewをbindする**。理由はセキュリティというよりlifecycleの正確さである：Coreがinstanceの存在を接続前から知っていれば、「開かれたが未接続」「接続せず閉じられた」を表現でき、runtimeへの通知やembedのdegrade判定が正確になる。hostはpanelをCoreからfetchする立場で既にCoreのclientなので、開くときの登録呼び出しは追加コストが小さい。

### lifecycle

```text
1. hostがpanelを開くことを決める（ユーザー操作・layout復元）
2. host → Core REST: instance登録（registrationId + panelIdを渡す）
   Core: instance idとticketを発行して返す。statusは pending
3. hostはview JSをmountし、contextに Core URL + ticket を渡す
4. view → Core WS: 接続し、ticketを提示してbind
   Core: ticketを検証し接続をinstanceにbind。statusは open
   Core → runtime: instanceが開いたことを通知
5. message交換。envelopeは {instance, payload} でpayloadはopaque
6. close:
   - viewのWS切断（unmount・UI App終了）→ Coreはinstanceを closed にしruntimeへ通知
   - runtimeの切断 → Coreはview接続へchannelが死んだことを通知
   - runtime側からのclose → Coreはviewへ通知しinstanceを閉じる
```

- 1つのWS接続は1つのinstanceにbindする。同一webview内の複数viewが接続を共有するmultiplexingは将来の最適化とし、まずはinstanceごとに接続する（loopback WSは安い）。
- ticketはinstanceのlifetime中有効とし、再接続に使える。loopbackの脅威モデルではこれで十分。

## 未決事項

- wire上の正確なmethod名とenvelope形式。REST path、`views.connect` / `views.message` / `views.event` 等の命名。Contract 00004への反映時に決める。
- runtime側から能動的にviewを開く逆方向の要否。現状はhostが開く方向のみ。
- UI Appが死んだときのinstance cleanupのタイミング。

# 用語集

Plugumiドキュメントで使う用語の正本。一般的な技術用語ではなく、**Plugumi独自の概念・使い分け**を記録する。新しい概念が生まれたらここに追加し、他のドキュメントはこの定義に従う。

各用語は `###` 見出しにしてあり、他のドキュメントから `glossary.md#<term>` の形で参照できる（例: `glossary.md#link`）。

## 構成要素

### Core

中央の仲介プロセス（`core/`、Go実装）。Plugin登録・Tool呼び出しのルーティング・Link管理を担い、機能ロジックは持たない。

### Plugin

機能を提供する任意言語のプロセス（`plugins/`）。Plugumi専用でも既存アプリの拡張としても作れる。

### UI Host

Plugin Viewsの実行・配信環境。Coreと接続し、環境固有の機能を担う役割。
Pluginが提供する（web・electron等のPluginがUI Hostを提供する）。表示専用で実行寿命を持たない。

### Plugin Views

Panel・Embed・Indicator等を表示するための共通インターフェース（仕様）。
実行環境ではなく、実行・配信はUI Hostの責務。

### Panel

UI Host上に表示されるPlugin提供のView。Panel↔Plugin間の通信はPluginの自由で、Plugumiの契約対象外。

## 接続・実行モデル

### Link

CoreとPluginが確立する1つの接続・登録単位。`POST /v1/link/hello` で始まり、transport切断または失効で終わる。`linkId` で識別。Tool呼び出しの宛先でもある。

### linkId

Core発行の一意ID。同一Plugin実装の複数接続（複数Core・複数Endpoint等）を区別するため実装IDとは別に持つ。MVPではlink-scoped。

### Transport

Linkと1対1で結ばれた双方向通信路（WebSocket + JSON-RPC 2.0）。CoreがPluginへ接続を開始し、`tools.call` 系（呼び出し・途中出力・終端・中断）だけがこの1本を流れる。登録・検査系はPlugin RESTで行う。transportの寿命とLinkの寿命は一致する。

### caller channel

Coreがcaller（Tool呼び出し元）向けに開くWebSocket接続（`GET /v1/call`、`docs/contracts/00001`）。Linkには紐付かず、connの寿命=接続の寿命。Pluginでないcaller（TUI・UI Host・スクリプト）は自身のtransportを持たないため、このchannel上で `docs/contracts/00003` のcaller側プロトコルをそのまま喋る。Transportとは別物。

### Node

Pluginが宣言する「実行環境」の共有識別（ローカル・Docker・リモートPC等）。Coreは意味を解釈しない。

## Tool・作業

### Tool

Pluginが提供する呼び出し可能な機能単位。`linkId + toolPath` で厳格に指定する。

### toolPath

登録内で一意なTool識別子（構造は未確定）。

### Tag

Toolに設定する検索用ラベル。

### Discovery

Tag・Schema等でTool候補を検索する仕組み。結果は `linkId + toolPath` が基本。

### Tool Call（invoke）

Toolの実行呼び出し。呼び出し元 → Core → 対象Plugin と仲介される。呼び出し元はPluginとは限らず、非Plugin callerはcaller channel経由で同じcaller側プロトコルを喋る。wireは `sync`/`async` の2形態（`docs/contracts/00003`）。

### callId

Tool呼び出しに紐付く全メッセージの相関キー。呼び出しrequestのJSON-RPC idをそのまま使う。追跡が要るときだけ保持するhandle。

### kind

Tool宣言に付ける形態ラベル（`sync` / `async`）。呼び出し元への期待として宣言側が指定し、wire機構は共通。

### Queue

Agent等への入力の待ち受け機構（priority/timing付き）。Plugin内部都合でありCore契約の外（`docs/decisions/00002`）。

### Subscribe（購読）

「監視して随時知らせる」使い方。`kind: async` で終端を持たないcallとして表す。閉じるのは呼び出し元のcloseかLink失効。

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

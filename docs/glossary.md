# 用語集

Plugumiドキュメントで使う用語の正本。一般的な技術用語ではなく、**Plugumi独自の概念・使い分け**を記録する。新しい概念が生まれたらここに追加し、他のドキュメントはこの定義に従う。

各用語は `###` 見出しにしてあり、他のドキュメントから `glossary.md#<term>` の形で参照できる（例: `glossary.md#link`）。

## 構成要素

### Core

中央の仲介プロセス（`core/`、Go実装）。新方式ではHTTPの接続先となり、Plugin登録・通知・RPC配送を担う。個々のアプリケーションの機能ロジックは持たない。

### Plugin

機能を提供する任意言語のソフトウェア。Plugumi専用プロセスでも、既存CLI・アプリの拡張としても作れる。新方式では利用者が指定したCoreへ自ら接続する。

### UI Host

Plugin Viewsの実行・配信環境。Coreと接続し、環境固有の機能を担う役割。
Web PluginやElectron Pluginが提供する。Tool実行やPluginプロセス自体の寿命を管理しない。

### Plugin Views

Panel・Embed・Indicator等を表示するための共通インターフェース（仕様）。
実行環境ではなく、実行はUI Hostが担う。アセットの配信主体は構成によって異なる。

### Panel

UI Host上に表示されるPlugin提供のView。新方式ではCore仲介RPCを操作通信の第一候補とし、Panel専用APIはToolと分ける。

### UI Bundle

Panel等を表示するためのビルド成果物。entrypointのほか、JS・CSS・画像・フォント・分割chunkなどの相対パス付きアセットを含む。パッケージ形式は未決定。

## 接続・実行モデル

### Registration

特定のCoreにおけるPluginインスタンスの論理的な登録。登録の識別子はv2草案では `registrationId`。物理接続から独立した寿命の候補を[接続契約の草案](contracts/00004-plugin-client-protocol.md)で比較する。

### Lease

期限内の更新を条件にRegistrationを維持するv2草案の候補。永続登録や通信路そのものとは異なる。

### Revision

Registryの観測時点を表す版。v2草案ではSSE通知とSnapshotの照合に使う。クライアントが連番やCore間での比較を仮定しない。

### Node

Pluginが宣言する「実行環境」の共有識別（ローカル・Docker・リモートPC等）。Coreは意味を解釈しない。

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

## Tool・作業

### Tool

Pluginが呼び出し元へ公開する機能単位。対象Core内のPlugin登録と `toolPath` で厳格に指定する。Panel専用操作はToolとは別に扱う。

### toolPath

登録内で一意なTool識別子（構造は未確定）。

### Tag

Toolに設定する検索用ラベル。

### Discovery

Tag・Schema等でTool候補を検索する仕組み。結果は対象Core内のPlugin登録と `toolPath` の組を基本とする。

### Tool Call（invoke）

Toolの実行呼び出し。呼び出し元はPluginに限らず、Coreが指定された対象Pluginへ仲介する。wireの形態はプロトコル版の契約で定義する。

### callId

呼び出しに紐付くメッセージの相関キー。識別子の有効範囲はプロトコル版の契約で定義する。永続的な実行IDを意味しない。

### kind

旧v1のTool宣言に付ける形態ラベル（`sync` / `async`）。

### Queue

Agent等への入力の待ち受け機構（priority/timing付き）。Plugin内部都合でありCore契約の外（`docs/decisions/00002`）。

### Subscribe（購読）

変更を継続的に受け取ること。旧v1では長時間の `kind: async` callを指す場合がある。v2草案のRegistry購読はSSEで行う。

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

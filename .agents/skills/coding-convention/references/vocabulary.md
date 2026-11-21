# 用語集（実装で確定した命名）

Go core・standard(Rust)・agent(TS) の3実装で揃える用語。変更するときは契約書と実装を同時に更新する。

## 原則

- **wireフィールド名はJSON契約と一致させる**（例: `wire.CallTarget.RegistrationID` はJSON `"registrationId"`）。内部名もwire名に揃え、層をまたいで別名を作らない
- **spec由来の用語はそのまま使う**。JSON-RPCの `Request`/`Response`/`Notification`、HTTPのstatus codeなど。独自語に変えると仕様書と読み比べられなくなる
- **型と名前を一致させる**。Registryと、Snapshotに含まれる登録の一覧を区別する（`registry` と `registrations`）

## 確定した対応

| 概念 | 名前 | 採用理由・却下した案 |
|---|---|---|
| JSON-RPC通信路（型） | `Connection`（全実装共通。旧Go `rpc.Conn`・TS `Conn`） | `Conn` は略称。agent/standardと統一 |
| Core上のPlugin登録 | `registration` / `registrationId` | 登録の期限はWS接続の寿命とは独立する |
| RPC切断時の呼び出しの掃除 | `DropConnection` | 接続に紐付くルートを外す。登録の失効とは別 |
| 途中出力notification | `tools.call.chunk` / `CallChunkParams` / `call.chunk(payload)` | `output` は最終結果と区別が付かない。`progress`・`event`・`emit` を検討して「順序あるデータ片」の `chunk` を選択 |
| 呼び出し両端 | `caller` / `target` | wireの宛先は `target: {registrationId, toolPath}` |
| call中断用senderのmap | `call_close_senders` | `calls` だとcall一覧にしか読めない |
| catalog変更の合図 | `catalogSignal` | `catalogCh` の `Ch` 略称を回避 |
| Pluginのローカル実行記録 | `plugininstances` | 各Pluginが記録の時刻を更新し、Go側は読み取りだけ行う。確認のためにPluginに接続しない |
| Pluginインスタンス識別子 | `plugin-…`（`new_instance_id` / `newInstanceId`） | Coreの `core-…` と対称。プロセスごとに生成する不透明な値 |

## 略称の許容範囲

- Go: `ctx`・`err`・単一文字レシーバ（`r`・`c`・`l`・`s`）
- Rust: channel端の `_rx`/`_tx`（tokio慣用。`close_rx`/`response_tx` 等はそのまま）
- それ以外のドメイン語の切り詰めは使わない（`rl`→`readlineInterface` の前例）

## JSON-RPCの前提知識

実装の意図を読むための最小限。

- メッセージは3種: `Request`（idあり）・`Response`（requestのidを返す）・`Notification`（idなし・返事なし）
- **id空間は送信者ごと・接続ごと**。同じconn上で双方向にrequestを飛ばせるため、routerが caller側id↔forward id を発行・書き換える（contracts/00003）
- notificationは `id` を持たないので、callとの紐付けは `params.callId` で行う
- error codeは `-32700..-32600` が規格予約、`-32000..-32099` が実装自由枠（transport切断・forward失敗に使用中）
- batch（配列でのまとめ送り）は未対応

## 中継（router）の語彙

- `forwardID`: Coreがtarget側connのid空間から発行するid。`route.TargetID`
- `ready`: 受理応答をcallerへ書き終えるまでnotification配送を止めるゲート（asyncのみ）
- `dropped`: route撤収を配送待機goroutineに伝えるchannel
- `accepted`: async callが `{accepted:true}` を返したか。立つとtarget死亡時にcallerへerror終端を送る対象になる

## Pluginの管理機構（3層）

- `plugincatalog`: ユーザーが設定した起動コマンド。`<config dir>/plugumi/plugins.json`。接続先はPluginの起動コマンドで指定する
- `plugininstances`: 起動中Pluginのローカル実行記録。`<cache dir>/plugumi/plugins/<id>.json`。`Instance{name,id,version,pid,heartbeatUnixSeconds,log}`
- `registry`: Core上のプロトコル登録。LeaseとTool宣言、WS接続を管理する。TUIはCoreからSnapshotを読む
- `log` フィールド: Plugin自身のログファイルパス。1プロセスが複数Coreに繋がるためCore側ではなくPluginの記録に持つ。パスはPluginが自分で決める
- `pluginRow`: TUIでcatalog定義と実行中Instanceを名前で突き合わせた1行。`running`・`registered` の2フラグで4状態を表す
- 起動操作: TUIのカタログ行やCLIはコマンドを起動するだけ。PluginからCoreに接続する

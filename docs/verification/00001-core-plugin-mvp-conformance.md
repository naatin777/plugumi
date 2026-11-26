---
type: verification
title: Core↔Plugin MVP 適合シナリオ
description: contracts/00001-00003に適合することを確認するシナリオ群。実装の適合判定はこのシナリオが全て動くことで行う。
status: deprecated
relations:
  contract:
    - '00001'
    - '00002'
    - '00003'
---

> 置き換え前のCore起点の `/v1` に対する履歴。現行 `/v1` の検証は[Verification 00002](00002-plugin-client-conformance.md)を参照。

## 対象と範囲

`docs/contracts/00001`（接続・Link）・`00002`（transport・メッセージ）・`00003`（Tool呼び出し）のMVP適合範囲。認証・Node・Plugin Views Protocol・Shared Context・リモートTLSは対象外。

## 前提条件と環境

- Core・検証用Pluginがloopbackで起動できること（現実装なら `cd core && ./plugumi serve`、`environment`・`plugins/agent`）
- 2つ以上のPlugin Endpointが使えること（複数Core・複数Pluginのシナリオ用）

## テストシナリオ

各シナリオは「操作→期待」の形。観測はCoreログ・Pluginログ・管理REST応答・transport上のメッセージで行う。

### L1. Link確立

| # | 操作 | 期待 |
|---|---|---|
| L1-1 | Core起動（plugins[]に未到達endpoint） | 接続の再試行が走る（3秒程度間隔） |
| L1-2 | Plugin起動 | `POST /v1/link/hello` が200、`GET /v1/tools` が200、`GET /v1/transport` が101、`POST /v1/tools/catalog` が200を順に返す |
| L1-3 | `POST /v1/plugins/list`（管理REST） | endpoint・`linkId`・`providerId` が返る |
| L1-4 | 異常: サポート外version（`/v2/…`）へのrequest | `426 protocol_mismatch`、Link未成立 |
| L1-5 | 異常: 未知pathへのrequest | `404 unknown_endpoint`、Link未成立 |
| L1-6 | `GET /v1/transport?linkId=<不正>` へのupgrade | `404 unknown_link`、upgrade失敗 |

### L2. Tool呼び出し

| # | 操作 | 期待 |
|---|---|---|
| L2-1 | sync tool呼び出し（echo） | responseにresultが直接返る（終端=response） |
| L2-2 | async tool呼び出し（exec） | 受理 `{accepted:true}` → output通知 → result通知の順で届く |
| L2-3 | 購読tool呼び出し（ticks） | 受理後outputが継続、`close`送信で停止する |
| L2-4 | 呼び出し中にcaller transport切断 | target側のcallも停止する（close伝播） |
| L2-5 | target transport切断で呼び出し中 | callerへ `tools.call.result` のerror終端（`-32000`） |
| L2-6 | 異常: 未知`linkId`へcall | `-32602 no such linkId` |
| L2-7 | 異常: 未知`toolPath`へcall | `-32601 no such toolPath` |
| L2-8 | 自己呼び出し（`call <自分のlinkId> <tool>`） | 同一conn上でcaller/target両役が動く |
| L2-9 | `tools.catalog` の受信 | caller Pluginがcatalog（REST POST）を受け、push内容で `linkId`+`toolPath` を得てcallできる |
| L2-10 | 同期Toolが途中出力を送る。対象は呼び出し元で途中出力を観測してから最終応答を返す | 呼び出し元は元のcallIdで途中出力を受け取り、その後に最終応答を受け取る |
| L2-11 | Coreが非同期受理を処理してから、呼び出し元に受理応答を送る前に対象のtransportが切断する | 呼び出し元には `{ "accepted": true }` の応答、続いて元のcallIdを持つ `tools.call.result` の `-32000` が届く |

### L3. transport = Linkの寿命

| # | 操作 | 期待 |
|---|---|---|
| L3-1 | transport切断（どちら側の都合でも） | Link失効。管理RESTのtools一覧から消え、次の `POST /v1/tools/catalog` で全Pluginへ伝搬する |
| L3-2 | ping停止90秒超 | Link失効。transportも閉じられる |
| L3-3 | 切断後の再接続 | `POST /v1/link/hello` からやり直し新Link。旧`linkId`へのcallは `no such linkId` |

### L4. 再起動・複数Core

| # | 操作 | 期待 |
|---|---|---|
| L4-1 | Plugin再起動→再接続 | 旧Linkが失効し新Linkに差し替わる。tools一覧に新旧が重複しない |
| L4-2 | Core再起動 | 全Link失効→Coreが再接続→`POST /v1/link/hello`で新Link。旧linkIdへのcallは `no such linkId` |
| L4-3 | 別Core（別port）から同じPluginへ接続 | Plugin側に2つのLinkが独立共存（`core.id` で区別）。両Coreのcatalogが生きている |
| L4-4 | 動的登録 `POST /v1/plugins` | 受理→非同期で接続→Link確立 |
| L4-5 | 異常: `POST /v1/plugins` 既知endpoint | `409 duplicate_endpoint` |
| L4-6 | 異常: `POST /v1/plugins` 非http(s) URL endpoint | `400 invalid_endpoint` |
| L4-7 | `POST /v1/plugins/remove` 登録済みendpoint | Link失効・`POST /v1/tools/list`から消滅・再登録で復帰 |
| L4-8 | 異常: `POST /v1/plugins/remove` 未登録endpoint | `404 unknown_endpoint` |
| L4-9 | 同じ `core.id` と新しい `linkId` でPluginへ再helloする | 旧transportが切断する。旧 `linkId` へのpingは `404 unknown_link` になり、新 `linkId` で接続できる |

### L5. セキュリティ境界

| # | 操作 | 期待 |
|---|---|---|
| L5-1 | Core管理REST待受が非loopback | Core起動エラー（認証なしMVPのためloopback必須） |
| L5-2 | Pluginプロセスの外向き接続 | PluginはCoreのURL・Domainを保持せず、外向き接続を開始しない |

### L6. caller channel（`GET /v1/call`）

PluginでないcallerがToolを呼ぶ経路。`docs/decisions/00011`・`docs/contracts/00001`「caller channel」・`docs/contracts/00003` caller側の適合を確認する。

| # | 操作 | 期待 |
|---|---|---|
| L6-1 | `GET /v1/call` へWS upgradeしsync toolをcall | responseにresultが直接返る（L2-1と同じcaller側意味論） |
| L6-2 | 同上でasync toolをcall | `{accepted:true}` → output通知 → result通知の順で届く |
| L6-3 | call中にcaller WSを切断 | target側のcallも停止する（`tools.call.close`転送。L2-4と同じ意味論） |
| L6-4 | callerが `tools.call` 以外のrequestを送る | JSON-RPC `-32601` |
| L6-5 | caller channelのconnがLink・registryに現れない | `POST /v1/plugins/list`・`tools/list` にcaller由来のentryが出ない |

## 結果と証拠

`feat/core-mvp`（`b05860f` 時点、2026-11-16）で実施した手動疎通の記録。

| # | 結果 | 証拠 |
|---|---|---|
| L1-1 | PASS | Core起動時に未到達endpointへ `[core] plugin … unreachable … (retrying)` が3秒間隔で出る |
| L1-2 | PASS | Coreログに `link:` → `catalog push` が順に出る。standard/agent両方で `POST /v1/link/hello`→`GET /v1/tools`→`GET /v1/transport`→`POST /v1/tools/catalog` が成功 |
| L1-3 | PASS | `POST /v1/plugins/list` が endpoint・`linkId`・`providerId` を返す |
| L1-4 | PASS | `/v2/…` へ `426 protocol_mismatch` |
| L1-5 | PASS | 未知pathへ `404 unknown_endpoint` |
| L1-6 | PASS | `GET /v1/transport?linkId=link-bad` へ `404` |
| L2-1 | PASS | `echo` → responseにresult直接返却 |
| L2-2 | PASS | `exec` 200行出力で `{accepted:true}` → output×200 → `{exitCode:0}` の厳密順序（response↔notification順序修正の確認を兼ねる） |
| L2-3 | PASS | `ticks` がoutput継続、`close <callId>` で停止 |
| L2-4 | PASS | caller切断でtarget側callも停止（close伝播） |
| L2-5 | PASS | target切断でcallerへ `tools.call.result` error終端 `-32000` |
| L2-6 | PASS | 旧linkIdへのcall → `-32602 no such linkId` |
| L2-7 | PASS | 未知`toolPath` → `-32601 no such toolPath` |
| L2-8 | PASS | `call <agentのlinkId> agent/echo` → `{"echo":{…},"from":"agent"}` |
| L2-9 | PASS | agentの `list` が `POST /v1/tools/catalog` 受信分を表示しcallできる |
| L3-1 | PASS | transport切断 → `link expired`、tools一覧から消えcatalog pushが走る |
| L3-2 | 未実施 | 90秒待機シナリオは未実施（ping送信自体は `lastPingAt` 更新で間接確認） |
| L3-3 | PASS | standard再起動 → 新linkId確立・旧linkIdへのcallは `no such linkId` |
| L4-1 | PASS | Plugin再起動で旧Link失効・新Linkに差し替わり、tools一覧に重複なし |
| L4-2 | PASS | Core再起動で全Link失効→再接続・新linkId |
| L4-3 | 未実施 | 2つ目のCore（別port）接続は未実施 |
| L4-4 | PASS | `POST /v1/plugins` `{"endpoint":"http://…"}` で受理→Link確立 |
| L4-5 | PASS | 既知endpoint再登録 → `409 duplicate_endpoint` |
| L4-6 | PASS | `{"endpoint":"ws://…"}` → `400 invalid_endpoint` |
| L4-7 | PASS | `plugins/remove` でLink失効・tools一覧0件・plugins一覧空、再登録でtools 5件に復帰（`feat/core-tui`） |
| L4-8 | PASS | 未登録endpoint → `unknown_endpoint` |
| L5-1 | PASS | `core.url` の非loopbackはconfig.Loadが起動エラー |
| L5-2 | PASS | Plugin実装に外向きHTTP/WS clientなし（待受と応答のみ。構造的確認） |
| L6-1 | PASS | `/v1/call` でsync `echo` → responseにresult返却（`feat/core-tui`、ctx紐付け変更後も再確認） |
| L6-2 | PASS | `/v1/call` でasync `exec`/`ticks` → `{accepted:true}`→output→resultの順序（`feat/core-tui`） |
| L6-3 | 未実施 | caller切断→close転送はL2-4と同一のrouter.DropConn経路。caller channelでの明示的切断は未検証 |
| L6-4 | PASS | `/v1/call` で `plugins.list` request → `-32601 method not found` |
| L6-5 | PASS | caller接続中も `plugins/list`・`tools/list` にcaller由来entryなし（callerはLinkを持たない構造） |

未実施は L3-2・L4-3・L6-3 の3件。いずれも契約違反の懸念ではなく時間・環境・追加検証を要するシナリオ。

追加したシナリオは2026-11-18にmacOS arm64上で確認した。

| # | 結果 | 証拠 |
|---|---|---|
| L2-10 | PASS | Coreの `go test -race ./internal/router`。模擬Pluginが最終応答を保留しても、呼び出し元で途中出力を受信できた |
| L2-11 | PASS | 同テストで受理応答の書き込み直前に対象の切断処理を挟み、呼び出し元のWebSocketで受理応答、`-32000` の終端通知を順に受信した |
| L4-9 | PASS | Environment ProviderとAgentを実プロセスで起動した。同一 `core.id` で再helloすると、旧WebSocketが切断し、旧Linkへのpingは `404 unknown_link`、新Linkのupgradeは成功した |

## 制限

- 数値（ping 30秒・失効90秒・retry 3秒）はcontractsの**推奨値**であり、異なる値でも適合とみなす。関係ルール（失効期限 > ping間隔）は守る
- transport上のメッセージ内容の詳細観測にはWSクライアントまたはtcpdumpが要る。`docs/contracts/00002`のtransportはJSON-RPCなので、JSONとして見えればよい

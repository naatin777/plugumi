---
type: verification
title: Core↔Plugin MVP 適合シナリオ
description: contracts/00001-00003に適合することを確認するシナリオ群。実装の適合判定はこのシナリオが全て動くことで行う。
status: draft
relations:
  contract:
    - '00001'
    - '00002'
    - '00003'
---

## 対象と範囲

`docs/contracts/00001`（REST接続）・`00002`（transport）・`00003`（Tool呼出）のMVP適合範囲。認証・Node・UI Protocol・Shared Contextは対象外。

## 前提条件と環境

- Core・検証用Pluginがloopbackで起動できること（現実装なら `cd core && ./plugumi serve`、`plugins/standard`・`plugins/agent`）
- 2つ以上のPlugin Endpointが使えること（複数Core・複数Pluginのシナリオ用）

## テストシナリオ

各シナリオは「操作→期待」の形。観測はCoreログ・Pluginログ・REST応答・transport上のメッセージで行う。

### L1. Link確立

| # | 操作 | 期待 |
|---|---|---|
| L1-1 | Core起動（plugins[]に未到達endpoint） | hello再試行が走る（3秒程度間隔） |
| L1-2 | Plugin起動 | `link.hello`→`tools.set`→transport upgradeが順に成功。Coreログに `link:` `tools.set:` `transport:` |
| L1-3 | `POST /v1/plugins/list` | endpoint・`linkId`・`pluginId` が返る |
| L1-4 | 異常: 未知`linkId`で `tools.set` | `401 unknown_link` |
| L1-5 | 異常: サポート外version（`/v2/link/hello` 等）へのリクエスト | `426 protocol_mismatch`、Link未成立 |

### L2. Tool呼出

| # | 操作 | 期待 |
|---|---|---|
| L2-1 | sync tool呼出（echo） | responseにresultが直接返る（終端=response） |
| L2-2 | async tool呼出（exec） | 受理 `{accepted:true}` → output通知 → result通知の順で届く |
| L2-3 | 購読tool呼出（ticks） | 受理後outputが継続、`close`送信で停止する |
| L2-4 | 呼出中にcaller conn切断 | target側のcallも停止する（close伝播） |
| L2-5 | target conn切断で呼出中 | callerへ `tools.call.result` のerror終端（`-32000`） |
| L2-6 | 異常: 未知`linkId`へcall | `-32602 no such linkId` |
| L2-7 | 異常: 未知`toolPath`へcall | `-32601 no such toolPath` |
| L2-8 | 自己呼出（`call <自分のlinkId> <tool>`） | 同一conn上でcaller/target両役が動く |

### L3. transportとLinkの寿命分離

| # | 操作 | 期待 |
|---|---|---|
| L3-1 | transport切断（Plugin側WSクローズ） | Linkは残る。`tools.list` にtoolが残り、Pluginがtransportを張り直せる |
| L3-2 | transport切断中にcall | `-32000 plugin transport unavailable` |
| L3-3 | ping停止90秒超 | Link失効。`tools.list` から消え、以後 `401 unknown_link` |
| L3-4 | transport切断後の再接続（同linkId） | 新しいtransportが差し替わる。Linkは継続 |

### L4. 再起動・複数Core

| # | 操作 | 期待 |
|---|---|---|
| L4-1 | Plugin再起動→再hello | 同endpointの旧Linkが失効し新Linkに差し替わる。`tools.list` に新旧が重複しない |
| L4-2 | Core再起動 | plugin側がtransport切断を検知→再helloで新Link。旧linkIdへのcallは`no such linkId` |
| L4-3 | 別Core（別port）から同じPluginへhello | Plugin側に2つのLinkが独立共存。両Coreの`tools.list`が生きている |
| L4-4 | 動的登録 `POST /v1/plugins` | 受理→非同期でhello→Link確立 |
| L4-5 | 異常: `POST /v1/plugins` 既知endpoint | `409 duplicate_endpoint` |
| L4-6 | 異常: `POST /v1/plugins` 非URL endpoint | `400 invalid_endpoint` |

### L5. セキュリティ境界

| # | 操作 | 期待 |
|---|---|---|
| L5-1 | `core.url` が非loopback | Core起動エラー（認証なしMVPのためloopback必須） |

## 結果と証拠

未実行。各シナリオの手動実施結果と日付をここに追記する（現状は `feat/core-mvp` の手動疎通で概ね確認済みだが、formalな記録はこれから）。

## 制限

- 数値（ping 30秒・失効90秒・retry 3秒）はcontractsの**推奨値**であり、異なる値でも適合とみなす。関係ルール（失効期限 > ping間隔）は守る
- WSメッセージ内容の詳細観測にはWSクライアントまたはtcpdumpが要る。`docs/contracts/00002`のtransportはJSON-RPCなので、JSONとして見えればよい

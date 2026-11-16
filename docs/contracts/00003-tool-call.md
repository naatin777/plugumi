---
type: contract
title: Tool呼出（WS + JSON-RPC 2.0）
description: 呼出元Plugin → Core → 対象Plugin のTool呼出契約。sync/asyncの2形態とcallId相関、終端・close・購読の扱いを定義する。
status: draft
relations:
  contract:
    - '00002'
  design:
    - '00001'
  requirement:
    - '00002'
---

## 当事者と範囲

呼出元Plugin・Core・対象Pluginの3者が実装する呼出契約。全メッセージは `docs/contracts/00002` のWS channel（JSON-RPC 2.0）上を流れる。

- 呼出経路は **呼出元Plugin → Core → 対象Plugin** 固定。Coreは宛先を解決・転送し、Tool内部の意味には踏み込まない
- 対象は**呼出元自身のRegistrationでもよい**（Pluginが自分のToolを経由呼出する用途。例: subagentがAgentのToolを呼ぶ）
- Tool呼出のwireは **sync と async の2形態のみ**。途中出力・通知・購読は別形態ではなく、async形態の意味論として表す

## 形態 — kind 宣言

Tool宣言（`tools.set`）は `kind: "sync" | "async"` を持つ。宣言側が呼出元への期待として付けるラベルであり、wire機構は共通である。

| kind | 意味論 |
|---|---|
| `sync` | 呼出元は完了まで待って次に進む。実行中に途中出力が流れてもよいが、終端が来るまで呼出元は結果を待つ |
| `async` | 呼出元は受理を受け取って先に進み、以後の出力・結果は呼出と並行して届く |

「監視して随時知らせる」購読は `async` の特殊な使い方とする: 終端を持たず開き続けるcall = subscribe。呼出元が閉じるかSession失効で終わる。

## 相関 — callId

JSON-RPC 2.0 の Notification は `id` を持たないため、呼出に続く全メッセージは **`params.callId`** で相関する。

- **callId = 呼出requestのJSON-RPC `id`**。Notificationの `params` に明示して載せる

```jsonc
{ "jsonrpc": "2.0",
  "method": "tools.call.output",
  "params": { "callId": "call-123", "payload": {} } }
```

- 通知は呼出のresponseを待たずに届く。呼出元は、複数の呼出を区別したいときだけcallIdを照合すればよい
- 1つの呼出に紐付く途中出力・終端・エラーはすべて同じcallIdを持つ

### idの一意性

requestの `id` は **接続ごと・送信者ごとの空間**で一意ならよい。Core中継では次のルールを取る。

- caller側接続とtarget側接続は別のid空間。Coreはtarget側へ送るrequestに **Core自身が発行するforward id** を使い、caller側のidとは別にする
- target側の `params.callId` はforward idを指す。Coreは呼出に紐付くmessageを中継するとき、各方間で `callId` をその区間のidへ書き換える
- 複数の呼出元が同じ `id` 値を使っても、Coreは `(接続, id)` の組で区別するため衝突しない

## 呼出の流れ

### sync

```
caller → Core → target:  tools.call request { target: { registrationId, toolPath }, input }
target → Core → caller:  tools.call.output  notification { callId, payload }*   // 途中出力（あってもよい）
target → Core → caller:  tools.call response                                   // 最終resultまたはerror
```

- response が終端。途中出力のnotificationが先行しても、呼出元はresponseを待って完了とする

### async

```
caller → Core → target:  tools.call request { target: { registrationId, toolPath }, input }
target → Core → caller:  tools.call response { accepted: true }                 // 受理
target → Core → caller:  tools.call.output  notification { callId, payload }*   // 途中出力（0〜N回）
target → Core → caller:  tools.call.result  notification { callId, result }     // 終端resultまたはerror
```

- 受理のresponseが先に返り、以後のnotificationは `params.callId` で相関する
- **購読**: `kind: async` で終端resultを返さないcall。呼出元は届くnotificationを受け続ける

### 閉じる

- `tools.call.close` notification `{ callId }`（呼出元 → 対象）— 開いているcall（購読・長時間実行）を呼出元側から閉じる
- Session失効で、そのSessionに紐付く全call・全購読は消える

## 途中出力とQueue

届いた途中出力・通知をいつ処理するかは受け手Pluginの内部都合である。Agent PluginがQueueに積む等の振る舞いは `docs/decisions/00002` の領域で、Core契約には含めない。

## エラー

- **経路の失敗**（未登録registrationId・未知toolPath・転送不可）はJSON-RPC errorとして呼出元へ返る。Tool内部の失敗と区別する
- **Toolの失敗**は終端result/errorに乗る。暗黙の成功扱いはしない
- Coreは別候補・別Nodeへの暗黙退避をしない（`docs/designs/00001`）

## 未解決の問い

- `tools.call.status` のような呼出状態のpull問合せを別methodとして持つか（通知だけで足りるか）
- `close` と `cancel`（実行中断要求）を区別するか — 現契約では `close` 一本
- 途中出力payloadの形（`tools.call.output` の中身・型分類）
- 購読callの途中出力の型・命名（`tools.call.output` との共用か専用化か）
- timeout・実行時間上限をCoreが持つか

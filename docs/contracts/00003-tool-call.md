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

- 呼出のrequestが持つ JSON-RPC `id` を、その呼出に続く全メッセージの相関キーとして使う。**callId = 呼出requestのid**
- 通知はcallIdなしでも自動的に届く（JSON-RPC id相関に乗る）。呼出元は追跡したい場合にだけidを保持する
- 1つの呼出に紐付く途中出力・終端・エラーはすべて同じidで相関する

## 呼出の流れ

### sync

```
caller → Core → target:  tools.call { target: { registrationId, toolPath }, input }
target → Core → caller:  tools.call.output*   // 途中出力（あってもよい）
target → Core → caller:  tools.call response  // 最終resultまたはerror
```

- response が終端。途中出力のnotificationが先行しても、呼出元はresponseを待って完了とする

### async

```
caller → Core → target:  tools.call { target: { registrationId, toolPath }, input }
target → Core → caller:  tools.call response { accepted: true }   // 受理
target → Core → caller:  tools.call.output*   // 途中出力（0〜N回）
target → Core → caller:  tools.call.result    // 終端resultまたはerror
```

- 受理のresponseが先に返り、以後のnotificationは request のidで相関する
- **購読**: `kind: async` で終端resultを返さないcall。呼出元は届くnotificationを受け続ける

### 閉じる

- `tools.call.close { callId }`（呼出元 → 対象）— 開いているcall（購読・長時間実行）を呼出元側から閉じる
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

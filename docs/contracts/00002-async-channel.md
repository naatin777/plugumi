---
type: contract
title: Plugin→Core 非同期channel（WS + JSON-RPC 2.0）
description: PluginがCoreへ開くWebSocket channel。Tool呼出・途中出力などrequest/responseで表せない送信用。方針レベルの骨格で、細部は後続で確定する。
status: draft
relations:
  contract:
    - '00001'
---

## 当事者と範囲

Plugin → Core 方向の非同期送信を担うchannel。REST（`docs/contracts/00001`）ではPlugin→Coreへのpush・途中出力を表せないため、永続的な双方向路を別transportで持つ。

- **Plugin → Core 方向にWS接続する**。Pluginは `session.hello` で得た `core_url` 宛てに接続を開く
- メッセージ形式は **JSON-RPC 2.0**（request/response/notification・id相関・error形状を再利用）

## なぜこの形か

- Plugin→Coreの送信は「いつでも・何回でも・継続的に」起こる（Tool実行中の中間出力等）。RESTのrequest/responseでは1送信1HTTPとなり、順序付きで連続する出力を表しにくい
- 一度貼ったWS上を双方向に流せるため、Core→Pluginの呼出・通知も同じ路に載せられる
- 詳細な採用理由（gRPC・Connectとの比較）は `docs/decisions/00007`

## ライフサイクル

1. `session.hello` 成立後、Pluginは `core_url` のWS Endpointへ接続する
2. 接続開始時にSessionを紐付ける（MVP仮決め: WS URLのクエリ `?sessionId=…` で提示）
3. WS切断はSession失効とは別に扱う（REST側のsession.pingがSession寿命を管理する想定）

## メッセージ意味論

- 同一WS上のメッセージは**到着順が保証される**
- ただし **WSの到着順とRPCの処理完了順は別物**である。並行処理されるrequestは処理順が入れ替わり得るため、「受信順=完了順」を前提にしてはならない。順序保証が要る処理は呼出側がid相関で追跡する
- 流れるmethod/notification（`tools.call`・途中出力等）の具体的な形は `docs/contracts/00003` で定義する

## セキュリティと適合性

- `docs/contracts/00001` と同じloopback・認証なし前提

## 未解決の問い

- 切断・再接続の扱い（未配送メッセージ・配送保証・再送）
- フロー制御（大量の途中出力時の背圧）

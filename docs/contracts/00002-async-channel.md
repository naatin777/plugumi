---
type: contract
title: Plugin→Core 非同期channel（WS + JSON-RPC 2.0）
description: PluginがCoreへ開くWebSocket channel。Tool呼出・Streaming出力などrequest/responseで表せない送信用。方針レベルの骨格で、細部は後続で確定する。
status: draft
relations:
  contract:
    - '00001'
---

## 当事者と範囲

Plugin → Core 方向の非同期送信を担うchannel。REST（`docs/contracts/00001`）ではPlugin→Coreへのpush・Streamingを表せないため、永続的な双方向路を別transportで持つ。

- **Plugin → Core 方向にWS接続する**。Pluginは `session.hello` で得た `core_url` 宛てに接続を開く
- メッセージ形式は **JSON-RPC 2.0**（request/response/notification・id相関・error形状を再利用）

## なぜこの形か

- Plugin→Coreの送信は「いつでも・何回でも・継続的に」起こる（Tool実行中の中間出力等）。RESTのrequest/responseでは1送信1HTTPとなり、順序付きの連続ストリームを表しにくい
- 一度貼ったWS上を双方向に流せるため、Core→Pluginの呼出・通知も同じ路に載せられる
- 詳細な採用理由（gRPC・Connectとの比較）は `docs/decisions/00007`

## ライフサイクル

1. `session.hello` 成立後、Pluginは `core_url` のWS endpointへ接続する
2. 接続開始時にsessionを紐付ける（`sessionId` を初回メッセージまたは接続パラメータで提示 — 形式は後続で確定）
3. WS切断はsession失効とは別に扱う（REST側のsession.pingがsession寿命を管理する想定）

## メッセージ意味論

- 同一WS上のメッセージは**到着順が保証される**
- ただし **WSの到着順とRPCの処理完了順は別物**である。並行処理されるrequestは処理順が入れ替わり得るため、「受信順=完了順」を前提にしてはならない。順序保証が要る処理は呼出側がid相関で追跡する
- 流れるmethod/notification（`tools.call`・streaming出力等）の具体的な形は後続で定義する

## セキュリティと適合性

- `docs/contracts/00001` と同じloopback・認証なし前提

## 未解決の問い

- このchannelに載せるmethod一覧（Tool呼出・Streaming出力・queue/hook操作・Core→Plugin通知）
- Core→PluginのinvokeをRESTで行うか、このWS上で行うか
- sessionとの紐付け方法（初回メッセージ・クエリパラメータ・別handshake）
- 再接続時の未配送メッセージの扱い

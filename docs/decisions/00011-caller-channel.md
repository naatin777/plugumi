---
type: decision
title: "caller channel: Coreがcaller向けWS endpointを持ち、非Plugin callerは同じcaller側プロトコルを喋る"
description: TUI・UI Host・スクリプト等のPluginでない呼び出し元がToolを呼ぶため、Coreが GET /v1/call のWS endpointを持つ。callerはLinkを持たず、connの寿命=接続の寿命。
status: draft
relations:
  contract:
    - '00001'
    - '00003'
  requirement:
    - '00004'
  design:
    - '00001'
---

## コンテキスト

`docs/contracts/00003` は呼び出し元→Core→対象Pluginのcaller側プロトコルを規定済みで、routerの `Route.Caller` はconn抽象でありPlugin transportに限定されない。しかしcaller側の**接続経路**が未定義で、Pluginでないcaller（人間向けTUI・将来のUI Host・スクリプト）がToolを呼ぶ術がなかった。

TUIをPluginとして実装する案もあったが、TUIはPluginではない（`docs/goals`・architectureの役割分担）。PluginはCore→Plugin方向にのみ存在し、自分でCoreへ接続する経路を持たないため、Plugin機構の上には乗せられない。

## 決定

1. **Coreがcaller向けWS endpoint `GET /v1/call` を持つ**。upgrade成功後は `docs/contracts/00003` のcaller側をそのまま喋る（`tools.call` request・response・`tools.call.output`/`result`受信・`tools.call.close`送信）
2. **caller connはLinkに紐付かない**。Link・linkId・catalog・pingの対象外で、connの寿命=接続の寿命。router上では `Route.Caller` がconn抽象なのでPlugin callerと同じroute modelに乗る
3. **caller channel上を流れるのも `tools.call` 系のみ**（Plugin transportと同じ制約）。`tools.call`以外のrequestはJSON-RPC `-32601`
4. **caller切断時はrouterがrouteを掃除し、進行中callへ `tools.call.close` をtargetへ転送する**（Plugin caller切断と同じ扱い）
5. **Core管理面（REST・`/v1/call`）はloopback前提**。認証・Origin検証は未解決事項として残る

## 代替案

- **TUI専用のREST call API**: 管理面にcall用RESTを別途生やす案。同期responseは表せるが、asyncのoutput/resultストリーム・closeをRESTで表すと結局独自protocolが要り、caller側プロトコル（00003）の再利用価値を捨てることになる。UI Hostが後で同じ需要を持つため経路を分ける意味も薄い
- **TUIをPlugin化**: TUIはCoreの状態を人間に見せるものであり、Toolを提供するPluginではない。PluginはCoreのURLを知らない原則とも衝突する
- **callerがPlugin transportを借用**: transportはCore→Plugin方向のLink専用で、callerが自分のLinkを持つ構造ではない。callerを擬似Pluginとして登録する設計はLink・catalog・pingの意味を歪める

## トレードオフと帰結

- **callerはLinkを持たないため、Link失効・catalog更新・ping監視の対象外**。caller connが生きている限りcallは維持され、切断で進行中callはclose転送される
- **caller切断→close転送はrouterの既存機構をそのまま使う**。Plugin callerと非Plugin callerで切断時の意味論が揃う
- **将来のUI Host・スクリプト・SDKは同じ `/v1/call` に乗れる**。caller側プロトコルの実装を1箇所に集約できる
- **browser由来のcaller（web UI Host）はOriginを送る**。MVPはloopback+認証なし前提でOrigin検証を省略しているが、外部公開する際はOriginポリシーと認証をセットで設計する必要がある（未解決）
- **caller channelは「Linkを持たないconn」というrouter上の第2のconn種別を生む**。Link前提の処理（catalog push・ping・tools pull）を書き足すときはcaller connを弾く分岐が要る

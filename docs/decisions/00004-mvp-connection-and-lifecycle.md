---
type: decision
title: MVPにおける接続・登録・管理面の境界
description: 実装可能な最小Coreに向けた決定。接続方向・起動形態・linkId寿命・管理面・リポジトリ構成。
status: draft
relations:
  architecture:
    - '00001'
  contract:
    - '00001'
  design:
    - '00001'
---

## コンテキスト

Coreの最初の実装を可能にするため、`docs/contracts/00001`・`docs/designs/00001` の open questions のうちMVPに必須のものを確定させる。対象は contracts/00001・designs/00001・architecture/00001。

## 決定

以下を採用する（MVP時点）。

1. **接続開始は必ず Core → Plugin**。PluginからCoreへの逆接続（登録・ペアリングの開始）はサポートしない。旧実装（旧ADR-0024）と同方向を踏襲する
2. **Pluginは接続前にCoreの情報を一切知らない**。Pluginは独立したサーバーとして待受、利用されるまでどのCoreに使われるかを知らなくてよい
3. **handshakeでCoreが `core_url` をPluginへ伝える**。接続後にPlugin→Core操作やPlugin UIからの到達が必要になるため。「接続前に知らない」は「接続後も知らない」ではない
4. **接続後の通信は双方向**。確立した接続上で、Core・PluginのどちらからでもRPCを呼べる
5. **Pluginの起動方法と接続方法は分離する**。通常プロセス・Docker・外部アプリの拡張など起動形態が異なっても、CoreはEndpointへ接続するだけ。MVPでは外部起動のみ（Coreはspawnしない）
6. **1つのPluginに複数のCoreが接続してよい**。Plugin側はLinkごとに独立して扱う
7. **Coreから到達できないPluginは利用対象外**。リモート環境の到達性（NAT越え等）は利用者がネットワーク構成で確保する
8. **linkId はLink毎に払い出し**。永続化しない。切断で失効し再接続で新IDになる
9. **MVPの可視化は標準出力**。接続中のPlugin・Tool一覧をログに出す。TUI統合は後続
10. **リポジトリ構成は `core/` と `plugins/` に分割**

## 代替案

- **Plugin→Core接続**: Pluginが接続先Coreを事前に把握する必要が生じる。以下の設計思想と矛盾するため採用しない:
  - **Pluginは特定のCoreに依存しない独立した機能提供者**。Core AとCore Bが同じPluginを使うために、Plugin側へ両方のURLを設定する必要はない。Pluginを起動しておくだけで、どのCoreからも使われ得る
  - **登録・利用の責務はCoreに集中する**。どのPluginを登録・利用するかはCoreが決め、Pluginが接続先を探す責務を持たない。「どのCoreへ接続するか」をPlugin自身が管理する形にしない
  - **再接続ロジックをCore1箇所に集約できる**。Plugin→Coreだと「Coreがまだ起きていない」場合の待機・再接続を各言語のPlugin SDKがそれぞれ実装する必要がある
  - リモート環境・NAT越えではPlugin→Coreの方が有利な場合もあるが、**Coreから到達できないPluginをサポート対象外とする**方針を採る
- **CoreがPluginをspawn**: プロセス監視・再起動方針・環境引継ぎまで決める必要がありMVPの範囲を超える。外部起動でも動作するため後付け可能
- **linkId永続発行（旧踏襲）**: Default選択・履歴紐付けが安定するが、再登録キー・state永続化まで設計が要る。Discovery→選択の流れを前提とすればlink-scopedでも成立するため先送り
- **TUIを最初から統合**: 見栄えは良いが、Core内部の登録・Link管理が先。一覧は標準出力で足りる

## トレードオフと帰結

- link-scoped IDにより、Core再起動・Plugin再接続後に旧 linkId を指す保存済み参照は全て無効になる。呼び出し側は毎回Discovery→選択を行う運用が前提になる
- 外部起動のみのため、「Core起動だけで環境が揃う」体験は将来のspawn機構に依存する
- Core→Plugin方向では、Coreが起動時刻より後に立ち上がったPluginへも再試行で接続する必要がある
- 標準出力のため、管理面のProtocol表出は後続のTUI/UI Host実装まで存在しない

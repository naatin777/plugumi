---
type: decision
title: MVPにおける接続・登録・管理面の境界
description: 実装可能な最小Coreに向けた決定 — 接続方向・起動形態・registrationId寿命・管理面・リポジトリ構成。
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

1. **接続方向は Core → Plugin**（PluginがWSサーバーとして待受）。旧実装（旧ADR-0024）と同方向を踏襲する
2. **handshakeでCoreが `core_url` をPluginへ伝える**。PluginのWeb UI等がCoreへ到達するために必要（旧実装と同じ方式）
3. **Pluginは外部起動のみ**。CoreはPluginプロセスをspawnしない。接続先endpoint一覧はCoreの設定で持つ
4. **registrationId はsession毎に払い出し**。永続化しない — 切断で失効し再接続で新IDになる
5. **MVPの可視化は標準出力**。接続中のPlugin・Tool一覧をログに出す。TUI統合は後続
6. **リポジトリ構成は `core/` と `plugins/` に分割**

## 代替案

- **Plugin→Core接続**: PluginがCore URLを知る必要がある。以下の理由で採用しない:
  - Pluginが「呼ばれる側」が基本であり、URLを持たない方が自然。Web UI等でCoreへ戻る必要がある場合は handshake で `core_url` を教えれば足りる
  - **Plugin側の実装負担が増える**。Plugin→Core接続だと「Coreがまだ起きていない」場合の再接続・待機ロジックを各言語のPlugin SDKがそれぞれ実装する必要がある。Core→Pluginなら再試行はGo実装のCore1箇所に集約できる
  - **Pluginはゼロ設定で起動できる**。serverを立てて待つだけで、Coreの所在・起動順序を一切知らなくてよい
  - **N:MでPlugin側の作業が増えない**。Plugin→Coreだと新しいCoreが増えるたびにPlugin側の接続設定を増やす必要がある。Core→PluginならPluginは受け入れるだけ
  - **Web UIと整合する**。Panel↔Plugin間はPluginが自由に選んだ通信を使う（`docs/contracts/00001` scope外）ため、Pluginがserverとして待受けることはブラウザからの到達性の前提でもある
- **CoreがPluginをspawn**: プロセス監視・再起動方針・環境引継ぎまで決める必要がありMVPの範囲を超える。外部起動でも動作するため後付け可能
- **registrationId永続発行（旧踏襲）**: Default選択・履歴紐付けが安定するが、再登録キー・state永続化まで設計が要る。Discovery→選択の流れを前提とすればsession-scopedでも成立するため先送り
- **TUIを最初から統合**: 見栄えは良いが、Core内部の登録・session管理が先。一覧は標準出力で足りる

## トレードオフと帰結

- session-scoped IDにより、Core再起動・Plugin再接続後に旧 registrationId を指す保存済み参照は全て無効になる。呼出側は毎回Discovery→選択を行う運用が前提になる
- 外部起動のみのため、「Core起動だけで環境が揃う」体験は将来のspawn機構に依存する
- Core→Plugin方向では、Coreが起動時刻より後に立ち上がったPluginへも再試行で接続する必要がある
- 標準出力のため、管理面のProtocol表出は後続のTUI/UI Host実装まで存在しない

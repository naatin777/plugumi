---
type: decision
title: MVPにおける接続・登録・管理面の境界
description: 実装可能な最小Coreに向けた決定 — 接続方向・起動形態・registrationId寿命・管理面・リポジトリ構成。
status: draft
relations:
  applies_to:
    - '00001'
---

## Context

Coreの最初の実装を可能にするため、`docs/contracts/00001`・`docs/designs/00001` の open questions のうちMVPに必須のものを確定させる。対象は contracts/00001・designs/00001・architecture/00001。

## Decision

以下を採用する（MVP時点）。

1. **接続方向は Core → Plugin**（PluginがWSサーバーとして待受）。旧実装（旧ADR-0024）と同方向を踏襲する
2. **handshakeでCoreが `core_url` をPluginへ伝える**。PluginのWeb UI等がCoreへ到達するために必要（旧実装と同じ方式）
3. **Pluginは外部起動のみ**。CoreはPluginプロセスをspawnしない。接続先endpoint一覧はCoreの設定で持つ
4. **registrationId はsession毎に払い出し**。永続化しない — 切断で失効し再接続で新IDになる
5. **MVPの可視化は標準出力**。接続中のPlugin・Tool一覧をログに出す。TUI統合は後続
6. **リポジトリ構成は `core/` と `plugins/` に分割**

## Alternatives

- **Plugin→Core接続**: PluginがCore URLを知る必要がある。Pluginは「呼ばれる側」が基本であり、URLを持たない方が自然（Web UI等でCoreへ戻る必要がある場合は handshake で教えれば足りる）
- **CoreがPluginをspawn**: プロセス監視・再起動方針・環境引継ぎまで決める必要がありMVPの範囲を超える。外部起動でも動作するため後付け可能
- **registrationId永続発行（旧踏襲）**: Default選択・履歴紐付けが安定するが、再登録キー・state永続化まで設計が要る。Discovery→選択の流れを前提とすればsession-scopedでも成立するため先送り
- **TUIを最初から統合**: 見栄えは良いが、Core内部の登録・session管理が先。一覧は標準出力で足りる

## Tradeoffs and consequences

- session-scoped IDにより、Core再起動・Plugin再接続後に旧 registrationId を指す保存済み参照は全て無効になる。呼出側は毎回Discovery→選択を行う運用が前提になる
- 外部起動のみのため、「Core起動だけで環境が揃う」体験は将来のspawn機構に依存する
- Core→Plugin方向では、Coreが起動時刻より後に立ち上がったPluginへも再試行で接続する必要がある
- 標準出力のため、管理面のProtocol表出は後続のTUI/UI Host実装まで存在しない

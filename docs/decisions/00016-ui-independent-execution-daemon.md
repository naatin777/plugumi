---
type: decision
title: UI非依存の実行のためにExecutionをCoreの第一級概念にする
description: UIのclose / reload / quitと実行寿命を分け、長時間実行をCore Daemonが管理するExecutionとして扱う方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00024'
  requirement:
    - '00004'
---

## コンテキスト

利用者は「UIは原則としてUIの状況によって処理に影響しない」「Electron appをquitしてもCore DaemonとExecutionは残る」を、プロジェクト開始以前からの前提として明示した。あわせて、コマンド1つでUIを開け、裏側に常駐基盤を持つDocker Desktop的なDaemon方式が候補になった。この検討案では、UI非依存原則をdurable executionへ適用し、host-session capabilityは寿命を明示した例外とする。

改訂前の[Contract 00004](../contracts/00004-plugin-client-protocol.md)では、`callId` は呼び出しメッセージの相関IDであり、永続的な実行IDではなかった。UI connectionが切れたときに実行状態を後から参照したり、別のUIからcancelしたりするモデルはなかった。

DeepSeek Harnessは比較対象として参考になった。window closeでは処理を残す一方、Desktop app quitではHostとtaskも止まる。Plugumiがより強いUI非依存原則を採るなら、この構成では不足する。

DeepSeek Harnessから採りたい要素は、window closeとquitの区別、Host準備を隠す起動体験、rendererへcredentialを渡さない構成、profile / bundleによる起動構成である。一方で、agent loopやsession logまでpluginにするeverything-is-a-pluginの徹底は採らない。

## 決定

- UIは実行の所有者ではなく、実行へのviewとする。
- renderer reload、Panel close、window close、UI app quitのいずれも、durableな実行中の作業を暗に停止しない。
- 停止は、明示的なExecution cancelまたはCore Daemon / managed provider全体の停止によって行う。
- 長時間処理はCore Daemonが管理するExecutionとして表す。Executionは少なくともID、operation、status、caller、target、作成・更新時刻、progress、resource refs、parent executionを持ち得る。
- UIはExecutionを開始、購読、一覧、cancelできる。UI connectionはExecutionを所有しない。
- Electronの操作は `Close Window`、`Quit Desktop UI`、`Shut Down Plugumi` を分ける。`Shut Down Plugumi` だけがCore Daemonとmanaged providerを止める操作であり、実行中の作業がある場合は確認する。
- host-sessionなcapability上の処理はこの保証の対象外である。capabilityに `daemon` / `node` / `host-session` / `ui-session` などの寿命 metadataを持たせ、Agentやbackground executionはdurable capabilityだけにbindする。

## 代替案

| 案 | 採らない理由 |
|---|---|
| DeepSeek Harness型。Desktop appがHostを所有し、quitでtaskも止める | 「Electron appをquitしてもCore DaemonとExecutionは残る」という前提に反する |
| UI connectionが実行を所有し、切断時に実行を止める | renderer reloadやwindow closeで処理が失われる。UI非依存原則に反する |
| 実行をProviderだけが持ち、Coreは配送だけを行う | CoreがExecutionを一覧・再取得・cancelできず、UIが後から状態へ追い付けない |

## トレードオフと帰結

- CoreはExecutionの状態、途中出力、結果参照、cancel要求を保持する必要がある。保存期間、容量、再起動後の復元範囲を別途決める。
- `callId` とExecution IDを分ける。[Decision 00024](00024-operation-invocation-context-and-execution.md)に従い、Contract 00004をoperation invocationとExecution中心へ直接改訂する。
- Host Capability Provider上の処理はhost-sessionで終わる。UI非依存の原則を保つため、capability選択時に寿命を明示しなければならない。
- provider processまたはprovider接続が失われた場合、runningなExecutionはresumeせずerrorとして扱う方向とする。provider終了が確認できる場合を `failed` / `provider_lost` のようなerrorにし、追跡不能な場合だけ `unknown` とするかはContractで定める。
- 再検討のきっかけ: Electron app quit後も残す対象を、Executionの記録だけにするのか、managed processそのものにもするのかを具体化するとき。

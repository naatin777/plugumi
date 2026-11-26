---
type: decision
title: Plugumi管理のPlugin runtime processを1 Core 1 processに割り切る
description: Plugumi管理のPlugin runtime processの寿命を1 Core : 1 provider session : 1 Plugin runtime processに限定し、multi-core serviceをmanaged lifecycleの対象外にする方針を記録する。
status: accepted
relations:
  architecture:
    - '00003'
  requirement:
    - '00003'
  decision:
    - '00012'
  design:
    - '00007'
---

## コンテキスト

Plugumiは複数Coreを前提にする。[Requirement 00003](../requirements/00003-plugin-ecosystem-support.md)は、Plugin processが複数Coreへ独立に接続できることと、Coreによる起動を接続の前提にしないことを求めている。一方で、1つのprocessが複数Coreへ接続し、さらにそのprocessをPlugumiがmanagedに起動・停止しようとすると、状態分離、process ownership、実行の所属、追加Coreの通知方法が難しい。

既存のmulti-core serviceへ新しいCoreを追加する場合、stdin / stdout、ファイル、local socket、既存Core接続経由のいずれを使うかという問題がある。しかし、stdinは親子関係へ依存し、ファイルは通知手段として弱く、既存Core接続経由では1つのCoreへservice全体の制御権を与えてしまう。remote serviceではlocalなstdinやfileをそのまま使えない。

LSPも、複数clientで1つのserverを共有する場合のdocument lockや同時編集調停を一般化せず、one server serves one toolを前提にしている。Plugumiでも、Plugumi管理のPlugin runtime processの共有を一般化しようとすると同様に複雑になる。

## 決定

- Plugumi管理のPlugin runtime processは `1 Core : 1 provider session : 1 Plugin runtime process` に割り切る。
- 同じPluginを複数Coreでenableにした場合は、Coreごとに独立したPlugin runtime processを起動する。既存processへ新しいCore接続を動的に追加しない。
- Plugin runtime processの起動時に、接続先Core、bootstrap credential、instance情報などのCore固有の情報を渡す。Core追加を既存processへ通知するためのstdin、file watch、local socket、既存Core接続経由の制御を標準lifecycleには使わない。
- Plugumi管理のPlugin runtime processのlifecycle制御はCore Daemonが担う。UI Appと`plugumi` CLIはenable / disable / stopをCore Daemonへ依頼する操作面であり、Plugin runtime processの直接所有者ではない。
- 実際にspawnする主体はPlugin runtime processが動く場所に合わせる。Core Daemonと同じlocal machineではCore Daemonのlocal process managerがspawnする。remote machine / container / WSLでは、その場所にあるsupervisorがspawnし、Core Daemonは起動・停止を委譲する。remote側のsupervisorはEnvironment Providerまたは外部systemが担う。
- 重いbrowser process、LLM service、hardware handleなどをPlugin内部で共有するかは、Plugin作者の自由とする。Plugumiがmanaged lifecycleとして見るのはCoreごとのPlugin runtime processだけであり、そのprocessが全機能を持つか、既に起動しているPlugin内部の共有serviceへ接続する薄いadapterかをplatformは規定しない。典型的には `Coreごとのlightweight adapter + Plugin内部の共有service` に分けられる。共有service自体がCoreへ直接接続する場合は、それはPlugin内部の私有resourceではなくself-managed / externalなmulti-core serviceとして扱う。
- Executionとproject contextは必ず1つのCoreに属するものとして扱う。Plugin内部の共有serviceを使っても、Execution、event stream、storage namespace、credential、resource ownershipをCore間で混ぜない。
- protocolレベルでは、1つのprocessが複数Coreへ接続することを禁止しない。ただし、そのようなprocessはself-managed / externalなserviceとして扱い、Plugumiのmanaged lifecycleでは起動・停止・接続先追加を管理しない。
- managedなuser-level multi-core serviceは持たない。multi-core serviceが必要な場合は、利用者または外部systemが起動し、接続先Coreの管理もそのservice側が行う。
- 利用者へ見せる操作は、CoreごとのPlugin enable / disableに留める。裏側がper-core processなのか、adapter + Plugin内部の共有serviceなのか、external serviceなのかを利用者へ選ばせない。

## 代替案

| 案 | 採らない理由 |
|---|---|
| managedなmulti-core serviceを標準にする | process ownership、incrementalなCore追加通知、障害分離、credential分離が複雑になる。最初にenableしたCoreをownerにもできない |
| 既存processへ新しいCore接続をstdinやfileで通知する | stdinは親子関係と単一writerへ依存し、fileは通知手段として弱い。remote serviceではどちらもそのまま使えない |
| 既存のCore接続経由で他Coreへの接続を指示する | 1つのCoreがservice全体の接続先を制御できてしまい、security boundaryを越える。未接続時のbootstrapもできない |
| 全Pluginをmulti-core対応必須にする | Plugin作者がsession管理、dynamic core追加、per-core credential、障害分離を意識する必要があり重い |
| 別のper-user plugin daemonを必須にする | 構造は分かりやすいが、常駐物と管理対象が増える。初期の軽量構成には重い |

## トレードオフと帰結

得るもの: Plugumi管理のPlugin runtime processの起動・停止・失敗域をCoreごとに閉じられる。2つ目のCoreを使うときに既存processを再起動せず、新しいprocessを起動するだけでよい。片方のCoreやprocessが落ちても他方へ影響しにくい。incrementalな接続先追加のための独自control channelを標準化しなくてよい。

失うもの: 軽量なPluginでもCoreごとにprocessが増える。process起動コストやmemory使用量は増え得る。Plugin内部の共有serviceが必要なPluginは、adapterと共有serviceの責務を分ける必要がある。真にmulti-coreなserviceを作る作者は、接続先管理やreconciliationを自分で設計する必要がある。

`1 Core : 1 provider session` は維持する。さらにPlugumi管理のPlugin runtime processについては、processもCoreごとに分ける。これはprotocolがmulti-core processを禁止する意味ではなく、Plugumiが管理する標準lifecycleを単純化するための制限である。

[Design 00007](../designs/00007-plugin-service-desired-state-reconciliation.md)で検討したmachine-managed desired stateとreconciliationは、managed user-level serviceを持たない方針とは合わない。self-managed / external serviceを作る作者向けの参考にはなるが、Plugumiの標準managed lifecycleには採用しない。

## 未解決の問い

- adapter + Plugin内部の共有serviceをPlugin manifestでどう宣言するか。共有serviceの起動・停止をPlugin内部へどこまで委ねるか。
- 同一Pluginのper-core processが増えたときのresource制限や起動遅延をどう扱うか。
- self-managed / external serviceが複数Coreへ接続するときの登録UX、credential配布、危険性表示。
- remote machineでPlugumi管理のPlugin runtime processを動かす場合、remote machine上のsupervisor / Environment Providerが何を所有するか。

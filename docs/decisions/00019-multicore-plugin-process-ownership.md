---
type: decision
title: multi-core Plugin processを許しつつlogical provider instanceはCoreごとに分ける
description: 1つのPlugin processが複数Coreへ接続できる範囲、状態分離、shared runtime、user-level serviceの所有を定める検討案。
status: draft
relations:
  architecture:
    - '00003'
  requirement:
    - '00003'
---

## コンテキスト

Plugumiは複数Coreを前提にする。[Requirement 00003](../requirements/00003-plugin-ecosystem-support.md)は、同じPluginプロセスが複数Coreへ独立に接続できることを求めている。一方で、1つのprocessが複数Coreへ接続すると、状態分離、process ownership、実行の所属、追加Coreの通知方法が難しい。

Electronがinstallable pluginではなくWorkbench Hostになったことで、UI Hostがmulti-core pluginである必要性は下がった。しかし、environment、browser、agent、既存アプリadapter、hardware integrationでは、1つのprocessまたはruntimeを複数Coreから使いたい場合が残る。

## 決定

- プロセスレベルでは、1つのPlugin processが複数Coreへ接続することを許可する。protocolからN:Nを排除しない。
- ただし、logical provider instanceは原則としてCoreごとに分ける。同じprocess内でも、Core A向けとCore B向けのregistration、session、event stream、storage namespace、Execution contextを混ぜない。
- Plugin SDKの標準mental modelは `1 Core : 1 provider session` とする。multi-core対応はadvanced APIまたはsession factoryとして隠蔽し、Plugin作者へ複雑さを直接見せない。
- Executionとproject contextは必ず1つのCoreに属するものとして扱う。shared runtimeを使っても、Executionの所有をCore間で混ぜない。
- 状態共有はopt-inとする。共有してよい候補はruntime process pool、file watcher、cache、model client、hardware handleなどである。agent session、project context、resource ownership、event stream、credentialへのアクセス権は原則として共有しない。
- 通常のPluginはCoreごとのmanaged processまたはmanaged sessionを標準形とする。
- browser runtime、LLM runtime、hardwareのように重いruntimeは、control planeを共有せず、`Coreごとのlightweight adapter + shared runtime` に分けることを優先する。
- 真にmulti-core serviceが必要なPluginは、最初に起動したCoreの所有物にしない。起動トリガとなったCoreと所有を分け、user-level serviceとして扱う。
- 既存のmulti-core serviceへ新しいCoreを動的に追加することを、一般Pluginの標準機能にはしない。必要な場合はmachine-managedなdesired stateとreconciliationを使う。詳細は[Design 00007](../designs/00007-plugin-service-desired-state-reconciliation.md)を参照。

## 代替案

| 案 | 採らない理由 |
|---|---|
| `1 Plugin process : 1 Core` に制限する | 実装は簡単だが、browser runtime、OS/hardware integration、既存アプリadapterのようにprocessを複製しにくいものを扱えない |
| 全Pluginをmulti-core対応必須にする | Plugin作者がsession管理、dynamic core追加、per-core credential、障害分離を意識する必要があり重い |
| 最初のCoreをshared processのownerにする | owner Coreを止めたとき他Coreへ影響し、disable / shutdownの意味が曖昧になる |
| 別のper-user plugin runtime daemonを必須にする | 構造は分かりやすいが、常駐物と管理対象が増える。初期の軽量構成には重い |

## トレードオフと帰結

- multi-core serviceはprocessを共有できるが、cross-core bridgeになる。credential、project context、resource参照の混線を防ぐため、shared runtimeとlogical provider instanceを分ける必要がある。
- adapter + shared runtime方式は、重いruntimeだけを共有できる。一方でadapter processが増え、Plugin作者がruntimeとadapterの責務を分ける必要がある。
- user-level serviceはCore shutdownで自動停止しない。利用者へはmanaged pluginとexternal / shared serviceの違いを状態表示で区別する必要がある。
- 複数Coreがtrust boundaryを兼ねる場合、shared runtimeやmulti-core serviceには明示的な許可が必要になる可能性がある。
- 再検討のきっかけ: browser / environment providerの実装で、per-core adapterとshared runtimeの分割が実際の状態共有を十分に軽くできないと分かったとき。

## 未解決の問い

- Plugin manifestがmulti-core対応をどう宣言するか。候補は `single-core`、`isolated-sessions`、`shared-runtime` のような区分である。
- shared runtimeのcacheやwatcherを、どこまでCore / projectごとにnamespaceするか。
- user-level serviceをどのタイミングで終了するか。全sessionが消えた後のidle終了を許すか。
- Coreがtrust boundaryを兼ねる場合の承認 UX。

---
type: design
title: self-managed / external Plugin serviceのdesired stateとreconciliation
description: multi-core対応のself-managed / external Plugin serviceが利用し得るdesired stateとreconciliationの検討。managed runtimeの標準lifecycleには採用しない。
status: deprecated
relations:
  requirement:
    - '00003'
  architecture:
    - '00003'
  decision:
    - '00019'
---

> managed plugin runtimeは[Decision 00019](../decisions/00019-multicore-plugin-process-ownership.md)により `1 Core : 1 provider session : 1 runtime process` に割り切る。managedなuser-level multi-core serviceは持たないため、このdesignはPlugumiの標準managed lifecycleには採用しない。self-managed / externalなmulti-core serviceを作る作者向けの参考として残す。

## 対応するrequirement

[Requirement 00003](../requirements/00003-plugin-ecosystem-support.md)は、self-managed / externalなPluginプロセスが複数Coreへ独立に接続できることを求めている。このdesignは、multi-core対応のself-managed / external Plugin serviceへ、Coreの追加・無効化・再接続指示を届ける方法を検討したものである。Plugumiの標準managed lifecycleには採用しない。

## 背景

Plugin initiated connectionでは、既存Plugin processはCoreへ自分から接続できる。しかし、後から追加されたCoreは既存Plugin processの場所を知らない。そのため、新しいCoreへの接続情報を渡すには、control API、共有desired state、process再起動、第三者coordinator、discoveryのいずれかが必要になる。

ここでは、新しい常駐coordinatorを増やさず、machine-managedなdesired stateを使う案を記録する。これは人間が直接編集する設定ファイルではない。

## モデル

状態を次の4種類に分ける。1つのファイルまたは1つのrecordへ混在させない。

| 状態 | 意味 | 主なwriter |
|---|---|---|
| desired session state | どのPlugin serviceがどのCoreへ接続してほしいか | enable / disable操作を行ったCoreまたはcontroller |
| runtime status | 実際に接続中か、どのgenerationまで反映したか | Plugin service |
| discovery state | 現在どのCoreが起動し、どこへ接続できるか | 各Core |
| credential state | bootstrap credentialやsession credential | 発行したCore、credential store、Plugin service |

desired stateは「接続中か」ではなく「接続してほしいか」を表す。runtime statusは「実際どうなっているか」を表す。両者を混ぜると、ズレたときに原因を判別できない。

## desired session record

概念的には、Coreごとに独立したrecordを使う。

```jsonc
{
  "plugin": "browser-provider",
  "coreIdentity": "core-b",
  "enabled": true,
  "generation": 12,
  "scope": {
    "kind": "core"
  },
  "bootstrap": {
    "credentialRef": "...",
    "expiresAt": "..."
  }
}
```

これはwire formatや保存pathを確定するものではない。重要なのは、次の情報を分けることである。

- 長期的な `coreIdentity` と、起動ごとの `coreInstanceId` を区別する。
- `generation` または同等の版を持ち、新しい意思と古い意思を区別する。
- `enabled` を明示し、recordがないこととdisableを区別できるようにする。
- credentialそのものではなく、短期間のbootstrap credentialまたはcredential refを扱う。

## 複数Coreへの起動シーケンス

このdesignは、真にmulti-core serviceが必要なPluginだけを対象にする。通常のPluginはCoreごとのprocess / sessionで起動し、重いruntimeを共有したい場合は `Coreごとのlightweight adapter + shared runtime` を優先する。利用者はその内部構成を選ばず、CoreごとにPluginをenable / disableするだけにする。

### desired stateと起動control planeを分ける

desired stateファイルは、起動や停止の命令そのものではない。これは「どのCoreへ接続しているべきか」を表す永続的な意思であり、再起動後の復元とreconciliationの正本である。ファイルだけではprocessを起動できず、変更を即時実行する仕組みにもならない。したがって、desired stateとは別に起動control planeが必要である。

起動control planeは `ensure` 型にする。`start` / `restart` ではなく、「このPlugin serviceが、このmachine上で、desired stateどおりに動いていることを確認する」操作にする。enable / disable操作を受けたcontrollerは、desired recordを書いたあとでensureを呼ぶ。

user-level serviceの起動は次の順で行う。

1. 利用者がCore AでPluginをenableにする。
2. controllerは、Plugin serviceがCore Aへ接続してほしいことを表すdesired recordを書く。
3. controllerはmachine-localなlauncher / supervisorに対してensureを実行する。
4. launcherはsingleton lockやprocess recordを確認し、serviceが未起動なら起動する。既に起動していればprocessを再起動しない。
5. serviceは起動時にdesired stateをfull scanし、enabledなCoreごとに独立したprovider sessionを開始する。
6. 利用者が同じPluginをCore Bでもenableにすると、controllerはCore B向けのdesired recordを追加し、再度ensureを実行する。
7. service processは既に起動しているため、launcherは再起動しない。serviceはwatch、optionalな起動通知、または定期full scanでCore B向けrecordを検出し、Core B向けのprovider sessionだけを追加する。
8. 利用者がCore Aでdisableにすると、controllerはCore A向けrecordの `enabled=false` と新しいgenerationを書く。serviceはCore A向けsessionだけをdrainして閉じ、Core B向けsessionには影響しない。
9. serviceが落ちたり再起動したりした場合は、起動時のfull scanで全Core分のdesired stateを読み直す。実行中だったsession状態を正本にはしない。

serviceへHTTP fetchするAPIだけを正本にしない。service未起動時にはfetch先が存在せず、起動不能になるためである。起動の正本はmachine-localなprocess spawn / supervisor制御とし、service内HTTP APIやsocketへの通知は、既に動いているserviceへ素早くreconcileさせるためのoptionalなfast pathに留める。

同じprocess内でも、Core A向けとCore B向けのregistration、session、event stream、storage namespace、Execution contextは混ぜない。共有してよいのは、Pluginが明示的に共有すると決めたruntime process pool、cache、model client、hardware handleなどだけである。

launcher / supervisorを誰が呼ぶか、およびその実体をCore Daemonのlocal process manager、Web / ElectronからのCLI invocation、Plugin package付属のlauncherのどれにするかは未決定である。ただし、user-level serviceのprocess所有権を最初にenableしたCoreへ縛ってはいけない。

## reconciliationの不変条件

Plugin serviceは、file watch eventだけを正確な通知として信用しない。watchは速報とし、起動時と定期間隔でfull scanする。

reconcileは冪等にする。何度実行しても、最終的には同じ状態へ近づくようにする。

1. desired recordにあるCoreへ接続していなければ、接続を試みる。
2. desired recordのgenerationが現在のsessionより新しければ、sessionを更新または作り直す。
3. `enabled=false` なら、対象Coreへのsessionをdrainして閉じる。
4. desired recordはあるがCoreが見つからなければ、sessionをpendingまたはretryingとして扱う。
5. 読み取り不能なrecordは、そのrecordだけをerrorにし、他のsessionを落とさない。

Plugin serviceは反映したgenerationをruntime statusへ `observedGeneration` として書く。これにより、まだ反映されていないのか、接続に失敗しているのかを区別できる。

## recordの書き込みとwriter

recordはCoreごとに分け、atomic writeで更新する。一時ファイルへ書いてからrenameし、書き込み途中のJSONを読まないようにする。

writerを分ける。

- desired session recordは、enable / disable操作を行ったCoreまたはcontrollerが書く。
- runtime statusはPlugin serviceだけが書く。
- discovery stateは各Coreが書く。
- credential stateは、発行・保管の責務を持つ要素だけが書く。

同じrecordを複数のactorが自由に書き換える形にしない。複数Coreが同じPluginへ接続する場合でも、Coreごとにrecordを分ける。

## disableと削除

disableを、いきなりrecord削除だけで表さない。最初は `enabled=false` と新しいgenerationを書く。

1. controllerが `enabled=false` を書く。
2. Plugin serviceが検知し、対象Coreへのsessionをdrainする。
3. 実行中のものがあれば、Executionの所有者とcapability寿命に従ってcancel、中断、または完了待ちを記録する。
4. Plugin serviceがstatusへ `observedGeneration` を書く。
5. その後のrecord削除またはcleanupは、反映を確認してから行う。

これはKubernetesのfinalizerに近い考え方である。ただし、Plugumiが完全なcontroller runtimeを実装するとは限らない。

## ズレと障害時の振る舞い

| 状況 | 振る舞い |
|---|---|
| watch eventを取りこぼした | 起動時または定期full scanで検出する |
| desired recordが壊れている | そのrecordだけerrorにし、他のsessionは維持する |
| desired directoryを読めない | 明示的に空の状態と区別し、実行中sessionを即座に落とさない |
| Core processが落ちた | 接続は切れる。desiredは残し、再起動後に再接続を試みる |
| Plugin serviceが落ちた | runtime statusのheartbeatが古くなる。managed / externalの区別に従って再起動またはoffline表示する |
| 同じPlugin serviceが二重起動した | singleton lock / leaseで検出し、一方を終了または待機させる |
| credentialが無効 | sessionを `unauthenticated` として表示し、再pairingまたは再bootstrapを要求する |

runtime statusにはheartbeatを持たせる。desired stateはexpireさせないが、runtime statusは古くなればoffline扱いにする。

## stable identity

desired stateがCoreを指すには、Core再起動後も変わらないidentityが必要である。起動ごとのinstance IDだけでは、再起動のたびにdesired recordと実行中instanceが一致しなくなる。

したがって、少なくとも次を分ける必要がある。

- `coreIdentity`: 長期的に同じCoreを表すID
- `coreInstanceId`: 現在起動しているprocessを表すID

現行のlocal instance registryはdiscovery stateの土台にできるが、そのままstable identityとは限らない。

## credentialの扱い

desired recordへ長期有効なcredentialを直接保存しない。Coreがbootstrap credentialを発行する場合は短期間または一回限りとし、Plugin serviceはそれをsession credentialへ交換する。

外部アプリや信頼境界をまたぐ接続では、user approval / pairingを必要に応じて挟む。Coreごとにcredentialを分け、1つのsession credentialを別Coreへ転用しない。

## 起動と終了

user-level serviceは、最初に必要になったCoreが起動トリガになってよい。ただし、起動したCoreがその後のownerになるわけではない。

- 必要になったCoreは、singleton lockを確認し、未起動ならserviceを起動する。
- 起動後のserviceはdesired stateをfull scanし、必要なsessionを張る。
- active / inactiveや「起動してほしいか」はfile-basedなdesired stateとして扱う。実際に動いているかはruntime statusとheartbeatで表し、同じrecordへ混ぜない。
- 全sessionが不要になった場合、idle timeout後に終了してよいかは未決定である。
- Core Daemon shutdown時にuser-level serviceを止めるかは、managed pluginと別に決める。

## 既存の仕組みとの対応

この考え方は、大きな構成管理システムそのものではない。必要なのは次の最小限の性質である。

- desiredとactualを分ける
- full scanと定期reconcileで収束させる
- generationで古い反映を識別する
- atomic writeとwriter分離で壊れにくくする
- 障害時に実行中sessionを不用意に落とさない

file watchだけで即時反映する方式は取りこぼしや競合が起きるため、単独では使わない。

## 未解決の問い

- desired stateの保存場所とディレクトリ構成。
- `enabled=false` recordを誰が最終的に削除するか。
- idle終了を許すか、明示停止だけにするか。
- singleton lock / leaseのOS差をどう吸収するか。
- stable core identityをどこへ保存し、複数Coreのnameとどう関係付けるか。
- bootstrap credentialの交換protocolをcontractとして定めるか。
- remote Coreをこのfile-based discoveryだけで扱うか、接続profileを別途持たせるか。

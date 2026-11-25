---
type: design
title: async Executionの即時表示と複数placement
description: sync / async operationの違い、async実行の即時feedback、inline / status area / panel / notificationへの同じExecutionの投影、子実行の集約を定める検討案。
status: draft
relations:
  requirement:
    - '00004'
  architecture:
    - '00003'
  decision:
    - '00016'
    - '00020'
  design:
    - '00008'
---

## 対応するrequirement

[Requirement 00004](../requirements/00004-common-protocol-contracts.md)は、Tool呼び出し・実行状態・通知を扱う共通の仕組みを求めている。このdesignは、async operationをUIへ即座に見せつつ、低levelな子実行で画面を埋めないための表示モデルを定める検討案である。

## 背景

toolにはsyncとasyncがある。sync toolは結果だけ返ればよい場合が多い。一方、async toolは長時間動く可能性があるため、呼び出し時点で進行状態を見せる必要がある。

ただし、AIが内部で多数の低level toolを呼ぶたびに大きなUIを出すと、Workbenchがノイズで埋まる。実行はすべて記録しつつ、表示はparent executionやtaskへ集約する必要がある。

## モデル

次の3つを分ける。

| 概念 | 意味 |
|---|---|
| Execution | Core Daemonが管理する実行。状態、進捗、結果参照、cancel対象を持つ |
| Execution View | 同じExecutionを表示するview。inline embed、status area、panel、notificationなどのplacementを持つ |
| artifact view | 実行結果としてできたresource / artifactを表示するview |

固定すべきなのはDOMやPanel実体ではなく、Executionへの参照である。同じExecutionは複数のplacementから表示できる。

## syncとasync

sync toolは、基本的に結果を直接返す。小さなrecordとして履歴へ残ってもよいが、大きな進行UIは不要である。

async toolは、最終結果の前にExecution refを返す。UIはそのrefを使って進行状態を購読できる。

```text
operation呼び出し
  -> execution/123
  -> status更新
  -> artifact / result
```

この区別により、長時間実行をcallerやUI connectionの寿命から分ける。

## placement

同じExecutionを複数の場所へ表示してよい。

| placement | 役割 |
|---|---|
| inline embed | どの文脈で実行が始まったかを示す |
| execution center / status area | 実行中のものを常に見つけられるようにする |
| panel | log、途中出力、詳細、関連resourceを見せる |
| notification | 完了、失敗、入力待ちを知らせる |

これらは別々の実行ではなく、同じExecutionへのviewである。inline embedを閉じてもExecutionは残る。panelを閉じても実行は止まらない。

## 表示の集約

すべての子tool呼び出しを個別の大きなcardにしない。Agentが検索、file read、shell実行を多数行っても、人間にはparent taskまたはparent execution単位で見せる。

例えば、

```text
Agent task
└── tests/run
    ├── shell execution
    ├── file reads
    └── intermediate outputs
```

という関係があるとき、通常の表示は `tests/run` またはAgent taskに畳む。詳細viewで子実行を見られるようにする。

ただし、machine-facingな記録は子実行も残す。表示しないことと記録しないことを混同しない。

## 正常系の流れ

例として `tests/run` を使う。

1. callerがasyncな `tests/run` を呼ぶ。
2. Coreは `execution/123` を作り、状態を `running` にする。
3. 呼び出し文脈にinline cardを出し、execution centerにも同じExecutionを出す。
4. 人間は必要に応じて詳細panelを開く。開かなくても実行は進む。
5. 実行が完了すると、`test-report/456` のようなartifactができる。
6. inline cardは結果summaryへ更新され、`結果を見る` affordanceが有効になる。
7. `結果を見る` を選ぶと、artifact viewである `TestResultViewer` をpanelまたは大きなembedで開く。

sync toolとは違い、async toolでは実行中UIと結果UIを分ける。実行中はExecution View、完了後の詳細はartifact viewを使う。

## UI切断とHost切り替え

UI connectionはExecutionを所有しない。Electronを閉じたり、Web tabを閉じたりしても、durable executionは継続する。

別Hostから開いた場合、execution centerまたはWorkbench状態から同じExecutionを見つけられる。inline embedが元のHostでしか見えなくても、Executionへの参照が残っていれば状態を復元できる。

host-session capabilityを使う実行は例外であり、Electron quitなどでruntimeが失われた場合は、Executionを失敗、中断、またはruntime unavailableとして記録する。詳細な記録方法は未決定である。

## cancel / retry / attention

Executionに対する操作はoperationとして表す。例えば `cancel`、`retry`、詳細を開く操作である。

現在使える操作はAffordanceとして表す。実行中はcancelできるが、完了後はcancelではなくretryが有効になる、という状態をcomponentではなく意味層で表す。

入力待ちがある場合は、Execution自体の表示とは別にInteractionを作る。Interactionはnotification、badge、pending interaction一覧へ反映できる。

## 表示優先度

presentation hintはあってよいが、最終的な表示はHostと呼び出し文脈が決める。

| 文脈 | 推奨される表示 |
|---|---|
| 人間が直接起動したasync tool | 即座にinline cardとexecution center entryを出す |
| Agentの親taskの一部 | 親taskへ集約し、子実行は詳細へ畳む |
| background execution | 前面へは出さず、execution centerと必要時のnotificationに留める |
| 入力待ち | Interactionとしてattentionを出す |
| artifact完成 | summaryを更新し、開く操作を提供する |

自動でpanelを前面に出すこととは別に、ExecutionをUIへ知らせることを分ける。UIへ知らせても、大きく開く必要はない。

## 未解決の問い

- sync toolの呼び出しをどこまで履歴へ残すか。
- parent execution / child executionの関係をoperation側がどう宣言するか。
- execution centerの標準UIをHost bundledにするか。
- inline embedを後から閉じた場合、同じExecutionを再表示する入口をどこへ置くか。
- notificationとbadgeの条件、通知済み状態の保存場所。
- artifact完成時に自動でpanelを開くことを許すか。

---
type: decision
title: Queue意味論 — priority 3段階 / timing 3種 / 途中出力=配送機構
description: Agent入力キューの priority・timing・途中出力 と queue の関係を決める。
status: draft
relations:
  requirement:
    - '00001'
---

## コンテキスト

`docs/requirements/00001` の制御をどう表現するか。旧実装では Agent の Run は入力受付後に閉じており、実行中の投入経路そのものが無かった。同時に Push通知・複数Part結果・Dynamic Hooks が長年Proposedのまま並立していた。今回の議論で、以下の3点が決まった。

## 決定

### 1. Queue Priority — `high` / `medium` / `low` の3段階

数値ではなく3段階。割り込みタイミングとは独立して順序だけを決める。

| Priority | 意味 |
|---|---|
| `high` | 緊急性が高い。次の処理可能なタイミングで優先（interruptほどではないが緊急性あり） |
| `medium` | 通常の入力（デフォルト） |
| `low` | 急がない通知・バックグラウンド処理の結果 |

例: `high` + `after_current` なら、現在のLLM推論を強制停止せず、次の推論前に優先して渡せる。

**Priorityは順序、Timingはいつ渡せるかを制御する。** 両者は独立した軸。

### 2. Queue Timing — `interrupt` / `after_current` / `after_all`

| Timing | 動作 |
|---|---|
| `interrupt` | 現在のAgent実行を中断し、即座に処理 |
| `after_current` | 次のLLM推論を呼び出す直前に処理 |
| `after_all` | Agentにやることがなくなったときに処理 |

`after_all` は単なるTurn終了ではなく、**AgentがIdleになったタイミング**と定義する。

```text
LLM推論
  ↓
Tool A / Tool B / Tool C
  ↓
次のLLM推論      ← after_current を投入
  ↓
さらにTool実行
  ↓
LLM推論
  ↓
Agent Idle       ← after_all を投入
```

`after_all` の入力を処理することで、新しいAgent Turnが始まることもある。

### 3. 途中出力とQueue — 途中出力は配送の仕組み

途中出力 は任意のタイミングで Tool Output Protocol を繰り返し返せる（wire上はasync形態の通知として届く — `docs/contracts/00003`）。**Queue専用の配送仕様は不要**であり、Queueにどう積むかは各出力メッセージが指定する。

```text
Tool（途中出力あり）
  │
  ├─ queue.append(...)
  ├─ queue.replace(...)
  ├─ hook.set(...)
  ├─ queue.merge(...)
  ├─ hook.patch(...)
  │
  └─ result(...)
```

これは Dynamic Hooks にもそのまま適用できる — hook操作も「実行中に届く出力メッセージ」として同じ配送路に乗る。

この統一により、旧実装で別々に検討されていた3つの問題が同じ機構で片付く: 進行中出力のPush（queue/hookメッセージ自体がpush）、複数PartのTool出力（`queue.*`群+`result`がPartに相当）、Dynamic Hooks（`hook.set/patch`として表現）。

## 代替案

- 数値priority: 細かい制御になるが、入力側に意味のある粒度を決めさせる負担が増え、実用上3段階で足りる
- timing を `interrupt` のみ / turn終了のみ: 緊急性と意図の両方を表せない
- Queue専用の配送仕様 or Queue操作専用API: Queue操作を出力メッセージとして表現すれば、配送路を汎用のまま共有できる
- Push通知・Hooksを別々の機構で実装: メッセージ種だけの拡張で済む統一モデルに対して経路が増える

## トレードオフと帰結

- priorityとtimingの直積（3×3）で、「interruptほどじゃないけど緊急性あり」等を自然に表現できる
- `after_all` の定義を「Idle」としたことで、Agent Turn境界の正確な意味をQueue実装側が持つ必要がある
- Tool Output Protocol に `queue.*` / `hook.*` のメッセージ種を持たせる設計が必要になる
- Queue自体は Agent Plugin 領域の概念であり、Core の AI 非依存性を侵さないこと — `queue.*` はCoreから見て単なる途中出力payload

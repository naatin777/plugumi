---
name: explanation-style
description: ユーザーへの説明スタイル。処理の流れ・通信・状態遷移など構造の説明を求められたときにmermaid図を使う。
---

# 説明スタイル

コードやアーキテクチャを説明するとき、テキストだけでなくmermaid図を使う。

- 通信・呼び出し順序 → `sequenceDiagram`
- 分岐・状態遷移・処理フロー → `flowchart`
- 図は説明の要点（id空間・順序保証・終端方向など構造が読み取れる部分）に絞り、全部を図にしない

対象は対話中の説明。specbook文書に図を足すときは `specbook-authoring` の規約に従う。

---
type: goal
title: 認知負荷の低減
description: 理解・判断・管理に必要な労力を減らす。Observability と Progressive Disclosure を両輪として達成する。
status: draft
relations:
  goal:
    - '00001'
---

## 成果

理解・判断・管理に必要な労力を減らす。

情報量を絞ることではなく、**今どこに注意を向けるべきかを判断しやすくする**ことを重視する。Observability（何が起きたか把握できる）と Progressive Disclosure（必要な粒度で掘り下げられる）をセットで実現する。

## 範囲

- 並列する作業・Agentの状況の見せ方、Queue・通知等の進行追跡の仕組み
- 対象外: 機能自体の削減・自動化による判断委譲 — 単純化はGoalではない（`docs/goals/00001`）

## 成功シグナル

- 並列するAgent作業で、どこに注意を向けるべきか一覧から判断できる
- 詳細情報（操作履歴・変更ファイル・Tool Call）は必要なときに到達でき、常時は情報量を絞れる

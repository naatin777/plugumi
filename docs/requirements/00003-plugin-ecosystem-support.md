---
type: requirement
title: Plugin開発・採用環境の整備
description: 第三者がPluginを作りやすく、他者のPluginを安全に採用できる支援が揃っていなければならない。
status: draft
relations:
  contributes_to:
    - '00004'
---

## Context

「欲しい機能がなければ、自分で作れ」を実現するには、作る側（自分・第三者の開発者）に開発環境が、使う側に採用判断の材料が必要。

## Requirements

- Pluginは好きな言語・好きなフロントエンドで書けなければならない MUST
- 第三者がCore実装を読まずに開発できる環境（SDK・ドキュメント・skill）がなければならない MUST
- 他者のPluginを採用する判断に必要な情報（何をするPluginか・危なくないか）を提供するskillがなければならない SHOULD

## Acceptance criteria

- 公開されたSDK・ドキュメント・skillだけを参照して、第三者が動作するPluginを作れる
- Plugin採用前に、そのPluginの振る舞い・権限・危険性を確認する導線がある

## Non-goals

- Plugin配布・発見の場（レジストリ等）の整備

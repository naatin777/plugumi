---
type: requirement
title: Plugin開発・採用環境の整備
description: 第三者がPluginを作りやすく、他者のPluginを安全に採用できる支援が揃っていなければならない。
status: draft
relations:
  goal:
    - '00004'
---

## コンテキスト

「欲しい機能がなければ、自分で作れ」を実現するには、作る側（自分・第三者の開発者）に開発環境が、使う側に採用判断の材料が必要。

## 要求事項

- Pluginは好きな言語・好きなフロントエンドで書けなければならない MUST
- Pluginは、利用者が指定したCoreへ自分から接続し、自前のHTTP/WS待受を公開せずに登録・機能提供・再接続ができなければならない MUST
- self-managed / externalなPluginプロセスは、複数Coreへ独立に接続できなければならない MUST。CoreがPluginを起動・停止することを接続の前提にしてはならない MUST NOT。managed runtimeの標準寿命をCoreごとのprocessに割り切ることは、このself-managed / externalな接続能力を禁止しない
- 第三者がCore実装を読まずに開発できる環境（SDK・ドキュメント・skill）がなければならない MUST
- 他者のPluginを採用する判断に必要な情報（何をするPluginか・危なくないか）を提供するskillがなければならない SHOULD

## 受入基準

- 公開されたSDK・ドキュメント・skillだけを参照して、第三者が動作するPluginを作れる
- 待受ポートを持たないPluginを二つのCoreへ接続し、一方を再起動しても他方で呼び出しを継続できる
- Plugin採用前に、そのPluginの振る舞い・権限・危険性を確認する導線がある

## 非目標

- Plugin配布・発見の場（レジストリ等）の整備

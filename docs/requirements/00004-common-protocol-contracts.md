---
type: requirement
title: 協調のための共通プロトコル契約
description: 人間・AI・Pluginが共通の意味を持つ操作・状態・情報を扱うため、Plugumi本体が提供する共通契約を定義する。
status: draft
relations:
  goal:
    - '00003'
    - '00004'
---

## コンテキスト

協調作業はメッセージを配送するだけでは成立しない。人間・AI・Pluginが共通の意味を持つ操作・状態・情報を扱えるよう、Plugumi本体が提供する共通契約を規定する。`docs/goals/00001` の「3つの共通契約」を要求として固定する。

## 要求事項

- プラットフォームは **Communication Protocol** を提供しなければならない（MUST）。Tool呼び出し・実行状態・通知を異なるツール間で扱う共通の仕組み
- プラットフォームは **Plugin Views Protocol** を提供しなければならない（MUST）。Panel・Embed・表示・操作の連携を通じて人間がPluginの機能や結果を利用できる仕組み。特定のフロントエンド技術に依存してはならない（MUST NOT）
- Panel専用操作は、AIに公開するToolとは独立に宣言・認可できなければならない（MUST）。Plugin ViewsはJSに加えてCSS、分割chunk、画像、フォント等も扱えなければならない（MUST）
- 登録・削除・Tool宣言の変更を購読側が知ることができ、切断で通知を逃しても現在の状態と再同期できなければならない（MUST）
- プラットフォームは **Shared Context / Resource Model** を提供すべきである（SHOULD）。何を対象に操作しているか・どの実行・作業に関係するかをPlugin間で参照できる仕組み。共有範囲と所有権は今後の設計事項
- 各契約は、人間とAIが**それぞれに適した方法で**同じ意味へアクセスできるものでなければならない。人間専用・AI専用に固定された形式のみを提供してはならない（MUST NOT）

## 受入基準

- 新しいPluginが既存Pluginの実装を参照せず、共通契約のみでToolを公開・呼び出せる
- AIによるファイル編集の結果を、人間側で対応するファイルや差分として開ける
- 人間の操作をAIが構造化された情報として受け取れる

## 非目標

- プロトコル統一そのものを目的にしない。人間が作業を把握・制御できなければ成功とみなさない（`docs/goals/00001`）
- Agent・Editor・Terminal等のアプリケーション実装をPlugumi本体へ組み込むこと（Pluginの責務）

## 未解決の問い

- Shared Context / Resource Model を独立した契約にするか、Communication Protocolの一部とするか
- 共有範囲・所有権のモデル

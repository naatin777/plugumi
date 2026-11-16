---
type: architecture
title: システム全体構成（Core / Plugin / Node / UI Host）
description: Plugumiの構成要素・責務・接続関係。旧実装から引き継ぐ設計思想と、新たに決める部分を分けて記述する。
status: draft
---

## Scope

Plugumi 全体の構成要素と接続関係。詳細な通信契約は `docs/contracts/00001`、信頼モデルは `docs/decisions/00001`、配布・運用面は `docs/decisions/00003` を参照。

## Components and responsibilities

| Component | 責務 | 担わないこと |
|---|---|---|
| Core（Go） | Plugin登録・Registration IDとNode対応の管理、Tool仲介・ルーティング・実行時権限検証、session管理 | AI・Plugin業務ロジック、Tool候補の自動選択、UI描画 |
| Plugin | Tool・Panel等の機能提供。Plugumi専用でも既存アプリの拡張としても実装できる | Coreへの言語・フロントエンド依存 |
| Node | Pluginの実行場所。ローカルホスト・リモートPC・Docker等を含む | 単一マシンへの限定 |
| UI Host（Web / Electron） | Panel表示・ユーザー操作面 | 実行の寿命。任意コンポーネント |

## 設計思想（旧実装から引き継ぐ不変条件）

- **CoreはAI非依存の汎用プラットフォーム**。AI Agent・Filesystem・Browser等はすべてPluginとして実装する（旧 `REQ-CORE-001` / ADR-0001 と同じ思想）
- **Plugin間の直接通信は禁止**。Tool呼出は `Plugin A → Core → Plugin B` の仲介経路のみ
- **UI Hostは表示専用**。Hostの起動・終了・切断はCore・Plugin・Tool実行の寿命に影響しない
- **NodeはPluginが宣言する「実行環境」の共有識別**であり、Coreはその意味を解釈しない（ローカル・Docker sandbox・リモートホスト等）
- **同一Pluginは複数登録できる**（複数Node・同一Node上）。例外として `standard` PluginはNodeごと最大1登録 — 旧実装の既存仕様であり、再検証対象

## 本体が提供するもの vs Pluginが実現するもの

Plugumi本体はアプリケーション機能を持たず、協調のための共通契約と実行基盤を提供する（`docs/requirements/00004`）。

| Plugumi本体が提供するもの | Pluginが実現するもの |
|---|---|
| Toolの公開・呼び出し | ファイル操作、Git操作 |
| Eventや非同期実行の仕組み | Agentの推論・Queue制御 |
| UIを提供・配置する仕組み | Editor、Terminal、Chat |
| ResourceやContextの参照・連携 | Project管理、Specbook |
| Pluginの接続・組み合わせ | 開発支援、日常作業の自動化 |

## Dependency and trust boundaries

- Core ↔ Plugin: WebSocket + JSON-RPC 2.0 の双方向（`docs/contracts/00001`）。接続は **Core → Plugin** で、Pluginが待受する。handshake時にCoreが `core_url` をPluginへ伝える
- Plugin信頼モデルは VS Code型 — インストール済みを信頼し、実行時隔離を持たない（`docs/decisions/00001`）
- 接続はローカル基本。リモート接続は任意追加（Tailscale・Cloudflare Tunnel + Access等、`docs/decisions/00003`）

## Runtime / deployment model

- CoreはCLI/TUIで単体管理可能。独立したManagerは必須にしない（`docs/decisions/00003`）
- UI Host無しでもCore+Pluginは動作する
- 静的ファイル: WebはGoサーバーから配信、Electronはアプリ同梱

## Open questions

- Node宣言の実装形態（旧実装はPluginがsession上で動的登録・実行時メモリのみ）

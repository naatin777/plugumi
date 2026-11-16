---
type: architecture
title: システム全体構成（Core / Plugin / Node / UI Host）
description: Plugumiの構成要素・責務・接続関係。旧実装から引き継ぐ設計思想と、新たに決める部分を分けて記述する。
status: draft
---

## 対象範囲

Plugumi 全体の構成要素と接続関係。詳細な通信契約は `docs/contracts/00001`、信頼モデルは `docs/decisions/00001`、配布・運用面は `docs/decisions/00003` を参照。

## コンポーネントと責務

| Component | 責務 | 担わないこと |
|---|---|---|
| Core（Go） | Plugin登録・LinkとNode対応の管理、Tool仲介・ルーティング・実行時権限検証 | AI・Plugin業務ロジック、Tool候補の自動選択、Plugin Viewの描画 |
| Plugin | Tool・Plugin View（Panel等）の機能提供。Plugumi専用でも既存アプリの拡張としても実装できる。Hostにもなり得る | Coreへの言語・フロントエンド依存 |
| Node | Pluginの実行場所。ローカルホスト・リモートPC・Docker等を含む | 単一マシンへの限定 |
| UI Host | Plugin Viewsの実行・配信環境。Coreとの接続・環境固有の機能。Pluginとして実装される（Web/Electron等） | 実行の寿命。任意コンポーネント |
| Plugin Views | Panel・Embed・Indicator等を表示する共通インターフェース（仕様） | 実行環境ではない（実行・配信はHost） |

## 設計思想（旧実装から引き継ぐ不変条件）

- **CoreはAI非依存の汎用プラットフォーム**。AI Agent・Filesystem・Browser等はすべてPluginとして実装する（旧 `REQ-CORE-001` / ADR-0001 と同じ思想）
- **Plugin間の直接通信は禁止**。Tool呼び出しは `Plugin A → Core → Plugin B` の仲介経路のみ
- **Hostは表示専用**。Hostの起動・終了・切断はCore・Plugin・Tool実行の寿命に影響しない
- **HostはPluginとして実装される**。Web・Electron等の環境自体もPluginであり、Hostはコンポーネント種別ではなくPluginが担う役割
- **NodeはPluginが宣言する「実行環境」の共有識別**であり、Coreはその意味を解釈しない（ローカル・Docker sandbox・リモートホスト等）
- **同一Pluginは複数登録できる**（複数Node・同一Node上）。例外として `standard` PluginはNodeごと最大1登録（旧実装の既存仕様・再検証対象）

## 本体が提供するもの vs Pluginが実現するもの

Plugumi本体はアプリケーション機能を持たず、協調のための共通契約と実行基盤を提供する（`docs/requirements/00004`）。

| Plugumi本体が提供するもの | Pluginが実現するもの |
|---|---|
| Toolの公開・呼び出し | ファイル操作、Git操作 |
| 非同期実行・通知の仕組み | Agentの推論・Queue制御 |
| Plugin Viewを提供・配置する仕組み | Editor、Terminal、Chat |
| ResourceやContextの参照・連携 | Project管理、Specbook |
| Pluginの接続・組み合わせ | 開発支援、日常作業の自動化 |

## 依存・信頼境界

- Core ↔ Plugin: WebSocket + JSON-RPC 2.0 に統一（`docs/contracts/00001` `00002`、`docs/decisions/00010`）。接続は **Core → Plugin** で、Pluginは待受と応答だけを行い、CoreのURL・Domainを知らない

## Link / Transport / Node の関係

- **Link**: CoreがPluginと確立する1つの接続・登録の単位。`link.hello` で開始し、Link失効で終わる。`linkId` がLink識別とTool呼び出しの宛先を兼ねる
- **Transport**: Linkと1対1で結ばれた双方向通信路（WebSocket + JSON-RPC 2.0）。transportの寿命とLinkの寿命は一致する
- **Node**: Pluginが宣言する実行環境の共有識別。LinkがどのNodeで動くかの対応をCoreが保持する

つまり `Link ⊃ (Transport・Tool宣言・Node宣言)` の包含関係で、MVPではすべてlink-scoped（`docs/decisions/00004`）。用語の定義は `docs/glossary.md` を正本とする。
- Plugin信頼モデルは VS Code型: インストール済みを信頼し、実行時隔離を持たない（`docs/decisions/00001`）
- 接続はローカル基本。リモート接続は任意追加（Tailscale・Cloudflare Tunnel + Access等、`docs/decisions/00003`）

## ランタイム・デプロイモデル

- CoreはCLI/TUIで単体管理可能。独立したManagerは必須にしない（`docs/decisions/00003`）
- Host無しでもCore+Pluginは動作する
- 静的ファイル: WebはGoサーバーから配信、Electronはアプリ同梱

## 旧実装からの継承・非継承

旧ADRは判断理由の参照であり、採用仕様ではない（`.agents/skills/specbook-authoring` の情報優先順位）。主な対応:

| 旧ADR | 判断 | 新Plugumi |
|---|---|---|
| ADR-0001 | CoreをAI非依存に | 継承（設計思想） |
| ADR-0021 | Plugin起動と接続を分離 | 継承（`docs/decisions/00004`） |
| ADR-0024 | Core→Plugin接続・逆接続禁止 | 継承（`docs/decisions/00004`） |
| ADR-0025 | 複数Core接続を妨げない | 受け入れるが、状態分離・競合の保証範囲は未確定 |
| ADR-0040 | 永続Registration ID | **非継承**（MVPはlink-scoped、`docs/decisions/00004`） |
| ADR-0071 | 階層Tool Path（配列表現） | toolPath構造は未確定 |
| ADR-0078 | CoreがPluginをspawn・管理 | MVPは外部起動のみ |
| ADR-0079 | HTTP/JSON Session Handshake | REST面は継承するがtransport追加で一部置換 |
| ADR-0093/0094 | Panel/Embed・共有State | 概念は参考。継承は未確定 |

## 未解決の問い

- Node宣言の実装形態（旧実装はPluginが接続上で動的登録・実行時メモリのみ）
- 複数Core接続時のPlugin状態の分離・共有範囲（旧ADR-0025は「妨げない」以上の保証をしていない）
- Plugin Viewの隔離方式（Light DOM・iframe等。旧実装も方針が複数回変わっており未確定）
- Workspace共有Stateの所有権（Core・Host間の配分は未確定）
- Agent固有の意味論（`after_current` 等のQueue timing）はPlugin側の責務。Coreに持ち込まない境界の確認（`docs/decisions/00002` と整合）

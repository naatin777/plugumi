---
type: decision
title: Coreの実装言語にGoを採用
description: CoreをGoで書く理由と、実装時点での主要ライブラリ方針。
status: draft
relations:
  architecture:
    - '00001'
---

## コンテキスト

Core（`core/` ディレクトリ）の実装言語を確定する。Pluginは任意言語で書けるため、ここで決めるのはCore本体のみ。

## 決定

Coreは **Go** で実装する。

理由:

- **単一バイナリ配布**: Coreを単独で配布・起動でき、`plugins/` やUI Hostを後から足せる。実行時依存が無い
- **並行処理**: 多数の同時WS接続（Pluginごとの常駐transport）をgoroutineで自然に扱える
- **ネットワーク・サーバー構築に強い**: HTTP/WSサーバー・リバースプロキシ・TLS等のエコシステムが成熟しており、常駐する接続仲介プロセスに向く
- **クロスコンパイル**: ローカル・リモート・コンテナ等の複数環境へ容易にビルドできる
- **標準ライブラリの充実**: net/http・json・flag等で外部依存を抑えられる

## 代替案

- **Rust**: 安全性・性能は上だが、開発速度とエコシステムの学習コストを考えるとMVPには重い
- **TypeScript/Node**: Plugin側と同じ言語で書ける利点はあるが、単体配布・常駐プロセスとしての運用がGoより重い
- **既存モノリスに載せる**: `docs/decisions/00005` の分割根拠と矛盾する

## トレードオフと帰結

- Plugin SDKをGo以外にも提供する場合、言語数だけ実装・検証コストが増える（Coreとは別の話だが関連する）
- MVP時点の主要選択:
  - WebSocket: `coder/websocket` 候補（旧nhooyr.io/websocketの維持fork。gorilla/websocketはメンテナンス停止気味）。標準libにWS実装は無いため外部依存が要る。導入時にユーザー許可を得る
  - JSON-RPC: 標準encoding/jsonで薄く実装
  - 設定ファイル: `plugumi.json`（標準 `encoding/json`。TOMLは外部依存になるため不採用）
- 外部ライブラリの追加は、標準libで足りるかを確認したうえでユーザー許可を得てから行う（`.agents/skills/coding-convention`）

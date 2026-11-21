---
type: design
title: Link Registry の設計（MVP）
description: Coreが保持するLink状態の構造・寿命・失効処理。
status: deprecated
relations:
  requirement:
    - '00002'
  contract:
    - '00001'
  decision:
    - '00004'
---

> 旧v1のLink Registry設計。新方式の登録寿命は[現行契約](../contracts/00004-plugin-client-protocol.md)を参照。

## 対応するrequirement

`docs/requirements/00002`（厳格な呼び出し先指定）は `linkId` で宛先を一意に識別する設計であり、そのlinkIdを保持・失効させる本体が本designのLink Registryである。`docs/contracts/00001` のLink lifecycleをCore内部のデータ・振る舞いとして定義する。

## モデルと不変条件

Coreはメモリ上に **Link Registry** を持つ。永続化しない（`docs/decisions/00004`、link-scoped決定）。

```
Link {
  linkId           // Core発行、Link識別・Tool呼び出しの宛先識別を兼ねる
  plugin: { id, version?, name? }   // POST /v1/link/hello 応答の識別情報
  endpoint         // Pluginの接続先（Core→Plugin HTTP接続用）
  tools: ToolDeclaration[]   // GET /v1/tools の応答で置き換えられる宣言リスト
  nodes: NodeDecl[]        // Node宣言は後続contract
  lastPingAt       // link.ping（Core→Plugin probe）の最終成功時刻
  state: active | expired
}
```

不変条件:

- `linkId` はLinkごとに新規発行・再利用しない
- `tools` は `GET /v1/tools` のpullによるアトミック置き換えのみで変化する
- Link失効時、tools・nodesは同時に消える
- Core再起動でregistryは空になる

## 振る舞い

1. **確立**: `POST /v1/link/hello` 成功で entry を `active` として登録する
2. **維持**: Coreが `POST /v1/link/ping` を定期送信する（MVP目安: 30秒間隔）。応答成功ごとに `lastPingAt` を更新する
3. **失効**: `lastPingAt` から一定時間（MVP目安: 90秒 = ping 3回分）経過したLinkを `expired` にし、registryから除去する。transport切断でも失効
4. **再試行**: 設定で指定されたPlugin Endpointへの接続失敗は、Coreが一定間隔で再試行する（Link未成立状態は registry entryを持たない）

## インターフェース

- `POST /v1/link/hello` `GET /v1/tools` `POST /v1/link/ping` `POST /v1/tools/catalog` `GET /v1/transport`（`docs/contracts/00001`）のCore側処理として実装する
- 標準出力または管理TUI（`plugumi tui`）でregistryの一覧を表示する（MVPの可視化）
- caller channel（`GET /v1/call`）のconnはLinkではないため本registryの対象外（`docs/decisions/00011`）

## 未解決の問い

- `link.bye` による明示終了を入れるか
- 失効間隔・ping間隔の確定値
- 同一Plugin実装の複数Link（重複Endpoint設定・手動複数起動）をどう扱うか。MVPではそのまま別Linkとして登録する想定

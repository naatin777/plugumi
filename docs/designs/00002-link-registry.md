---
type: design
title: Link Registry の設計（MVP）
description: Coreが保持するLink状態の構造・寿命・失効処理。
status: draft
relations:
  requirement:
    - '00002'
  contract:
    - '00001'
  decision:
    - '00004'
---

## 対応するrequirement

`docs/requirements/00002`（厳格な呼び出し先指定）は `linkId` で宛先を一意に識別する設計であり、そのlinkIdを保持・失効させる本体が本designのLink Registryである。`docs/contracts/00001` のLink lifecycleをCore内部のデータ・振る舞いとして定義する。

## モデルと不変条件

Coreはメモリ上に **Link Registry** を持つ。永続化しない（`docs/decisions/00004`、link-scoped決定）。

```
Link {
  linkId           // Core発行、Link識別・Tool呼び出しの宛先識別を兼ねる
  plugin: { id, version?, name? }   // link.hello応答の識別情報
  endpoint         // Pluginの接続先（Core→Plugin REST用）
  tools: ToolDecl[]        // tools.set で置き換えられる宣言リスト
  nodes: NodeDecl[]        // Node宣言は後続contract
  lastPingAt       // link.ping の最終受信時刻
  state: active | expired
}
```

不変条件:

- `linkId` はLinkごとに新規発行・再利用しない
- `tools` は `tools.set` によるアトミック置き換えのみで変化する
- Link失効時、tools・nodesは同時に消える
- Core再起動でregistryは空になる

## 振る舞い

1. **確立**: `link.hello` 成功で entry を `active` として登録する
2. **維持**: Pluginが `link.ping` を定期送信する（MVP目安: 30秒間隔）。Coreは受信ごとに `lastPingAt` を更新する
3. **失効**: `lastPingAt` から一定時間（MVP目安: 90秒 = ping 3回分）経過したLinkを `expired` にし、registryから除去する
4. **再試行**: 設定で指定されたPlugin Endpointへの接続失敗は、Coreが一定間隔で再試行する（Link未成立状態は registry entryを持たない）

## インターフェース

- `link.hello` `tools.set` `link.ping`（`docs/contracts/00001`）のCore側処理として実装する
- 標準出力でregistryの一覧を表示する（MVPの可視化）

## 未解決の問い

- `link.bye` による明示終了を入れるか
- 失効間隔・ping間隔の確定値
- 同一Plugin実装の複数Link（重複Endpoint設定・手動複数起動）をどう扱うか。MVPではそのまま別Linkとして登録する想定

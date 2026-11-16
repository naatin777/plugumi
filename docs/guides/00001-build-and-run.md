---
type: guide
title: MVPのビルドと起動
description: Core（Go）と最小Plugin（standard/Rust・agent/TS）のビルドと、3プロセスでの疎通確認手順。
status: draft
relations:
  contract:
    - '00001'
    - '00002'
    - '00003'
---

## 対象読者と前提条件

MVP実装をローカルで動かす開発者。Go 1.24+・Rust(cargo)・Node 24+・npm が入っていること。

## ビルド

```sh
cd core && go build -o plugumi ./cmd/plugumi
cd plugins/standard && cargo build
cd plugins/agent && npm install && npm run build
```

## 手順

1. Core を起動: `cd core && ./plugumi serve`（`core/plugumi.json` の `core.listen` と `plugins[].endpoint` を読む）
2. standard Plugin を起動: `cd plugins/standard && cargo run`（既定 `127.0.0.1:9001`）
3. agent Plugin を起動: `cd plugins/agent && node dist/main.js`（既定 `127.0.0.1:9002`、stdinコマンドループが開く）

PluginはCoreを事前に知らない。Coreが `POST /v1/session/hello` で接続し、Pluginは受け取った `core_url` 宛てに `tools.set`・`ping`・WS channelを張る。

## Pluginの動的登録

`plugumi.json` の `plugins` は空でも起動できる。実行中にEndpointを追加する場合:

```sh
curl -X POST http://127.0.0.1:7700/v1/plugins \
  -H 'content-type: application/json' \
  -d '{"endpoint":"http://127.0.0.1:9001"}'
```

登録は受理のみ — Session確立は非同期（Coreが再試行しながらhelloを送る）。登録済み一覧は `POST /v1/plugins/list`。agentのコマンドループからも `register <endpoint>`・`plugins` で操作できる。

動的登録はランタイムのみ（再起動で消える）。定常構成は `plugumi.json` に書く。

## 期待される結果

Coreログに session → tools.set → ws channel が順に出る。agentのコマンドループで:

```
list                                        # 登録済みの全Tool（registrationId + toolPath）
plugins                                     # 登録済みPlugin Endpoint一覧
register <endpoint>                         # Plugin Endpointを動的登録
call <registrationId> echo {"hello":"w"}    # sync: responseに結果
call <registrationId> exec {"command":"echo hi"}  # async: 受理response + 途中出力 + 終端result
call <registrationId> ticks {"intervalMs":500}    # 購読: closeまで継続
close <callId>                              # 開いているcallを閉じる
call <agentのregistrationId> agent/echo {}   # 自己呼出（呼出元自身をtargetにできる）
```

## トラブルシューティングと制限

- `serve` のbind失敗はエラー終了（別portへの自動退避はしない）
- Pluginを再起動すると新しい `sessionId`/`registrationId` が払い出される（session-scoped）
- ping 30秒・失効90秒。Plugin再起動時は同endpointの旧Sessionが新helloで差し替えられる

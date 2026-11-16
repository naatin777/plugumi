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

MVP実装をローカルで動かす開発者。Go 1.26+・Rust(cargo)・Node 24+・npm が入っていること。

## ビルド

```sh
cd core && go build -o plugumi ./cmd/plugumi
cd plugins/standard && cargo build
cd plugins/agent && npm install && npm run build
```

## Coreの使い方

```sh
cd core
./plugumi serve -config plugumi.json   # -config省略時は ./plugumi.json
```

サブコマンドは `serve` のみ（フォアグラウンド常駐）。`start`/`ps`/`stop` のdaemon機構は未実装。

### 設定 `plugumi.json`

```json
{
  "core": { "url": "http://127.0.0.1:7700" },
  "plugins": [ { "endpoint": "http://127.0.0.1:9001" } ]
}
```

- `core.url`: Coreの外部向けURL。REST+WSの待受アドレス（host:port）はここから導出し、Pluginへ渡す`core_url`にもそのまま使う。**loopback必須**（`0.0.0.0`・`:7700`等は起動エラー。MVPは認証なしのため外部公開を防ぐ）
- `plugins[]`: 静的なPlugin Endpoint一覧。空でも起動できる

### Coreが提供する操作

| 操作 | 内容 |
|---|---|
| `POST /v1/plugins` `{endpoint}` | Plugin Endpointを動的登録（Link確立は非同期） |
| `POST /v1/plugins/list` | 登録済みEndpoint一覧（linkId/pluginId付き） |
| `POST /v1/tools/list` `{linkId}` | 登録中の全Tool（最小Discovery・暫定） |
| `POST /v1/tools/set` `{linkId, tools}` | Tool宣言のアトミック置換（Pluginが呼ぶ） |
| `POST /v1/link/ping` `{linkId}` | Linkを維持するping（Pluginが30秒間隔で呼ぶ） |
| `GET /v1/transport?linkId=` | Plugin→Coreのtransport（呼び出し専用・OpenAPI対象外） |
| `GET /openapi.json` | OpenAPI 3.1 spec（`/openapi.yaml`も） |
| `GET /docs` | API仕様の閲覧UI（Stoplight Elements） |

### 動作モデル

- CoreはPluginへ `POST /v1/link/hello` し、linkId（UUID）を払い出す
- Pluginはhelloの `core_url` 宛てに `tools.set`・`ping`・transport接続を行う
- ping 90秒無しでLink失効。transport切断はtransportを外すだけでLinkは残り、Pluginがtransportを接続し直す
- Plugin再起動（再hello）は同endpointの旧Linkを差し替える
- 1つのPluginに複数Coreが接続してよい（Core別のLinkが共存する）

## 手順

1. Core を起動: `cd core && ./plugumi serve`
2. standard Plugin を起動: `cd plugins/standard && cargo run`（既定 `127.0.0.1:9001`）
3. agent Plugin を起動: `cd plugins/agent && node dist/main.js`（既定 `127.0.0.1:9002`、stdinコマンドループが開く）

PluginはCoreを事前に知らない。Coreが `POST /v1/link/hello` で接続し、Pluginは受け取った `core_url` 宛てに `tools.set`・`ping`・transport接続を行う。

## Pluginの動的登録

`plugumi.json` の `plugins` は空でも起動できる。実行中にEndpointを追加する場合:

```sh
curl -X POST http://127.0.0.1:7700/v1/plugins \
  -H 'content-type: application/json' \
  -d '{"endpoint":"http://127.0.0.1:9001"}'
```

登録は受理のみで、Link確立は非同期（Coreが再試行しながらhelloを送る）。登録済み一覧は `POST /v1/plugins/list`。agentのコマンドループからも `register <endpoint>`・`plugins` で操作できる。

動的登録はランタイムのみ（再起動で消える）。定常構成は `plugumi.json` に書く。

## 期待される結果

Coreログに link → tools.set → transport が順に出る。agentのコマンドループで:

```
list                                        # 登録済みの全Tool（linkId + toolPath）
plugins                                     # 登録済みPlugin Endpoint一覧
register <endpoint>                         # Plugin Endpointを動的登録
call <linkId> echo {"hello":"w"}            # sync: responseに結果
call <linkId> exec {"command":"echo hi"}    # async: 受理response + 途中出力 + 終端result
call <linkId> ticks {"intervalMs":500}      # 購読: closeまで継続
close <callId>                              # 開いているcallを閉じる
call <agentのlinkId> agent/echo {}          # 自己呼び出し（呼び出し元自身をtargetにできる）
```

## トラブルシューティングと制限

- `serve` のbind失敗はエラー終了（別portへの自動退避はしない）
- Pluginを再起動すると新しい `linkId` が払い出される（link-scoped）
- ping 30秒・失効90秒。Plugin再起動時は同endpointの旧Linkが新helloで差し替えられる

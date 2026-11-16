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

- `core.url`: Coreの管理REST APIの待受URL（Plugin向けではなく人間・UI Host向け）。**loopback必須**（`0.0.0.0`・`:7700`等は起動エラー。MVPは認証なしのため外部公開を防ぐ）
- `plugins[]`: 静的なPlugin Endpoint一覧（`http://` または `https://` URL）。空でも起動できる

### Coreが提供する操作（管理REST・Plugin向けではない）

| 操作 | 内容 |
|---|---|
| `POST /v1/plugins` `{endpoint}` | Plugin Endpointを動的登録（Link確立は非同期） |
| `POST /v1/plugins/list` | 登録済みEndpoint一覧（linkId/pluginId付き） |
| `POST /v1/tools/list` | 登録中の全Tool（人間・UI Host向け確認用） |
| `GET /openapi.json` | OpenAPI 3.1 spec（`/openapi.yaml`も） |
| `GET /docs` | API仕様の閲覧画面（Stoplight Elements） |

### 動作モデル

- Coreは `POST /v1/link/hello` でLinkを確立しlinkId（UUID）を払い出し、`GET /v1/tools` でTool宣言をpullする。`GET /v1/transport` のWS upgradeはTool呼び出し用のみ
- Coreは `POST /v1/tools/catalog` で全Tool一覧をPluginへpushする
- **PluginはCoreのURL・Domainを知らない**。全てCore→Pluginの接続で、Pluginは受け答えだけを行う
- transport切断 = Link失効。再接続は `POST /v1/link/hello` からやり直し（新linkId）
- `POST /v1/link/ping` が90秒成功しないとLink失効（半開き検出用）
- 1つのPluginに複数Coreが接続してよい（`core.id` 別のLinkが共存する）

## 手順

1. Core を起動: `cd core && ./plugumi serve`
2. standard Plugin を起動: `cd plugins/standard && cargo run`（既定endpoint `http://127.0.0.1:9001`）
3. agent Plugin を起動: `cd plugins/agent && node dist/main.js`（既定endpoint `http://127.0.0.1:9002`、stdinコマンドループが開く）

Pluginの起動引数は `http://<host>:<port>` のendpointそのもの（Coreが接続するURLと同じ文字列）。`https://` はTLS未実装のため受理しない。

PluginはCoreを知らない。Coreが `POST /v1/link/hello` でLinkを確立し `GET /v1/tools` でTool宣言を取りに来る。PluginはREST応答とWS upgradeの受付だけを行う。

## Pluginの動的登録

`plugumi.json` の `plugins` は空でも起動できる。実行中にEndpointを追加する場合:

```sh
curl -X POST http://127.0.0.1:7700/v1/plugins \
  -H 'content-type: application/json' \
  -d '{"endpoint":"http://127.0.0.1:9001"}'
```

登録は受理のみで、Link確立は非同期（Coreが再試行しながら接続を試みる）。登録済み一覧は `POST /v1/plugins/list`。

動的登録はランタイムのみ（再起動で消える）。定常構成は `plugumi.json` に書く。

## 期待される結果

Coreログに hello → GET tools → transport upgrade → catalog push が順に出る。agentのコマンドループで:

```
list                                        # POST /v1/tools/catalogで受け取った全Tool（linkId + toolPath）
call <linkId> echo {"hello":"w"}            # sync: responseに結果
call <linkId> exec {"command":"echo hi"}    # async: 受理response + 途中出力 + 終端result
call <linkId> ticks {"intervalMs":500}      # 購読: closeまで継続
close <callId>                              # 開いているcallを閉じる
call <agentのlinkId> agent/echo {}          # 自己呼び出し（呼び出し元自身をtargetにできる）
```

## トラブルシューティングと制限

- `serve` のbind失敗はエラー終了（別portへの自動退避はしない）
- Pluginを再起動すると新しい `linkId` が払い出される（link-scoped）
- ping 30秒・失効90秒。Core再起動後はCoreが再dialし、同じ `core.id` の旧Linkは新helloで差し替えられる

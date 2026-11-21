---
type: guide
title: Plugin起点のビルドと接続
description: ローカルでCoreとStandard・Agentを起動し、HumaのOpenAPIからクライアントを生成する。
status: draft
relations:
  contract:
    - '00004'
  guide:
    - '00001'
---

旧[起動手順](00001-build-and-run.md)を置き換える。Go、Rust、Node.js 24以上とpnpmが必要。

## 起動

リポジトリのルートでビルドする。

```sh
(cd core && go build -o plugumi ./cmd/plugumi)
(cd plugins/standard && cargo build --locked)
(cd plugins/agent && pnpm install --frozen-lockfile && pnpm run build)
```

Agentのビルドは生成先の `dist/` を作り直す。手書きのファイルは `dist/` に置かない。

別々の端末から次を実行する。

```sh
./core/plugumi serve --port 7700
./plugins/standard/target/debug/plugumi-standard --core http://127.0.0.1:7700
pnpm --dir plugins/agent start --core http://127.0.0.1:7700
./core/plugumi tui
```

`--core` は複数回指定できる。一つだけなら `PLUGUMI_CORE_URL` でも指定できる。Coreが `PLUGUMI_TOKEN` を設定しているときは、同じ値をPluginとTUIにも環境変数として渡す。Coreはloopback限定で、共有トークンは組織向けの認可を代替しない。

StandardとAgentは、登録またはWebSocketの接続時にHTTP `401`・`403`・`426` を受け取ると、そのCoreへの再試行を止める。他のCoreには影響しない。指定したCoreすべてから拒否された場合は終了コード `1` を返す。診断に出た接続先とHTTPステータスを確認する。

TUIのDetailは選択中のCoreの登録をSSEとSnapshotで更新する。接続済みのStandardの下から `echo` を選んで呼び出せる。StandardはToolを提供するだけなので、Registryを購読しない。

Agentの `core [番号]` は操作するCoreを表示・選択する。`list` と `call <registrationId> <toolPath> [json]` は選択中のCoreに対して使う。`close <callId>` には呼び出しの応答に表示されたIDを渡す。AgentはCoreの選択を変えていても、元のRPC接続だけに取消を送る。元の接続がなくなったら、新しい接続には送らない。

AgentはToolの出力を標準出力に表示し、自身の診断ログには書かない。診断は標準エラーとキャッシュ内の `plugumi/logs/` に書く。ただし、`plugumi plugins start` など標準出力を保存する起動方法では、起動側のログにToolの出力が残ることがある。

`plugumi plugins add <名前> --command '<起動コマンド>'` はローカル起動コマンドを登録する。`plugumi plugins remove <名前>` はその登録だけを削除し、実行中のPluginを停止したり、Coreへの登録を解除したりはしない。Coreへの接続はPluginが開始する。

Pluginの接続先はPlugin側で指定する。Coreの `plugumi.json` に `plugins` が残っている場合は、その項目を削除する。ローカルカタログの `plugins.json` に `endpoint` が残っている場合は、その項目を削除し、起動定義には `name` と `command` を指定する。既存の設定は自動で変換・上書きしない。Core自身の `--port` と `core.url` は引き続き使える。

## RESTクライアントの型生成

HumaがCoreの実装からRESTのOpenAPIを生成する。APIリファレンスは `http://127.0.0.1:<port>/docs` で閲覧できる。`/docs` と `/openapi.json`・`/openapi.yaml` はトークンを設定したCoreでも認証なしで取得できる。既に入手した OpenAPI Generator CLI のJARを使う例。

```sh
curl -fsS http://127.0.0.1:7700/openapi.json -o openapi.json
java -jar "$OPENAPI_GENERATOR_JAR" validate -i openapi.json
java -jar "$OPENAPI_GENERATOR_JAR" generate -i openapi.json -g go -o sdk/go
java -jar "$OPENAPI_GENERATOR_JAR" generate -i openapi.json -g typescript-fetch -o sdk/typescript
java -jar "$OPENAPI_GENERATOR_JAR" generate -i openapi.json -g rust -o sdk/rust
```

生成対象は登録・Lease・Tool宣言・一覧のREST。SSEの復旧とJSON-RPCは生成されたHTTPクライアントと分け、[接続契約](../contracts/00004-plugin-client-protocol.md)を参照する。

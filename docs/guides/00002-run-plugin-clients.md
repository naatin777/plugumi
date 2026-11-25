---
type: guide
title: Plugin起点のビルドと接続
description: ローカルでCoreとEnvironment Provider・Agentを起動し、HumaのOpenAPIからクライアントを生成する。
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
pnpm install --frozen-lockfile
pnpm run build
(cd core && go build -o plugumi ./cmd/plugumi)
(cd environment && cargo build --locked)
```

ルートはpnpm workspaceで、TypeScriptのパッケージ（`packages/*`、`shared/*`、Agent、Web Workbench Hostのフロントエンド、Electron Workbench Host）を `pnpm run build` でまとめてビルドする。Environment ProviderはheadlessなRustバイナリであり、UIをバイナリへ同梱しない。file explorerはWorkbenchに同梱されるbuiltin Panelで、`fs/list` を宣言した登録から呼び出す。各パッケージのビルドは生成先の `dist/` を作り直す。手書きのファイルは `dist/` に置かない。

別々の端末から次を実行する。

```sh
./core/plugumi serve --port 7700
./environment/target/debug/plugumi-environment --core http://127.0.0.1:7700
pnpm --dir plugins/agent start --core http://127.0.0.1:7700
./core/plugumi tui
```

`--core` は複数回指定できる。一つだけなら `PLUGUMI_CORE_URL` でも指定できる。Coreが `PLUGUMI_TOKEN` を設定しているときは、同じ値をPluginとTUIにも環境変数として渡す。Coreはloopback限定で、共有トークンは組織向けの認可を代替しない。

Environment ProviderとAgentは、登録またはWebSocketの接続時にHTTP `401`・`403`・`426` を受け取ると、そのCoreへの再試行を止める。他のCoreには影響しない。指定したCoreすべてから拒否された場合は終了コード `1` を返す。診断に出た接続先とHTTPステータスを確認する。

TUIのDetailは選択中のCoreの登録をSSEとSnapshotで更新する。接続済みのEnvironment Providerの下から `echo` を選んで呼び出せる。Environment ProviderはToolを提供するだけなので、Registryを購読しない。

Agentの `core [番号]` は操作するCoreを表示・選択する。`list` と `call <registrationId> <toolPath> [json]` は選択中のCoreに対して使う。`close <callId>` には呼び出しの応答に表示されたIDを渡す。AgentはCoreの選択を変えていても、元のRPC接続だけに取消を送る。元の接続がなくなったら、新しい接続には送らない。

AgentはToolの出力を標準出力に表示し、自身の診断ログには書かない。診断は標準エラーとキャッシュ内の `plugumi/logs/` に書く。ただし、`plugumi plugins start` など標準出力を保存する起動方法では、起動側のログにToolの出力が残ることがある。

`plugumi plugins add <名前> --command '<起動コマンド>'` はローカル起動コマンドを登録する。`plugumi plugins remove <名前>` はその登録だけを削除し、実行中のPluginを停止したり、Coreへの登録を解除したりはしない。Coreへの接続はPluginが開始する。

Pluginの接続先はPlugin側で指定する。Coreの `plugumi.json` に `plugins` が残っている場合は、その項目を削除する。ローカルカタログの `plugins.json` に `endpoint` が残っている場合は、その項目を削除し、起動定義には `name` と `command` を指定する。既存の設定は自動で変換・上書きしない。Core自身の `--port` と `core.url` は引き続き使える。

## Web Workbench Host

Web Workbench Hostはブラウザ向けの画面を提供する。フロントエンドを先にビルドし、Goのバイナリに同梱する。フロントエンドが未ビルドでも `go build` は通るが、画面の代わりに案内文が表示される。

```sh
(cd apps/web && go build -o plugumi-web ./cmd/plugumi-web)
```

フロントエンドは、上の `pnpm run build` でビルド済みになる。画面の本体はWorkbench（`shared/workbench`）にあり、Web Workbench Hostのフロントエンドは、それにHTTPでの通信（`ShellHost` の実装）を渡す入口だけを持つ。

URLでCoreを指すにはCore名が要る。Coreを `--name` 付きで起動する（`plugumi.json` の `core.name` でもよい）。名前には小文字の英数字とハイフンだけを使える。同じOSユーザーで、同じ名前のCoreを2つ起動することはできない。

```sh
./core/plugumi serve --port 7700 --name local
./apps/web/plugumi-web --core http://127.0.0.1:7700
```

Web Workbench Hostは `[web] listening on http://127.0.0.1:<port>` を出力する。ブラウザで開くと、`/` にCoreの一覧が表示される。`--listen 127.0.0.1:7800` を指定すると、待受のポートを固定できる。

`/` の画面からCoreのURLを追加できる。追加したURLは設定ディレクトリの `plugumi/web.json` に保存され、次回の起動でも使われる。追加できるのは、Core名を設定してあり、他のCoreと名前が重ならないCoreだけである。Web Workbench Hostが自身のパスに使う `api`・`assets`・`ui` もCore名として使えない。保存されるのはURLなので、追加するCoreはポートを固定して起動する。`--core` で指定したCoreは画面から削除できない。

## Electron Workbench Host

Electron Workbench HostはWeb Workbench Hostの配る画面をデスクトップアプリのwindowで開くviewerである。Coreへ自分で接続せず、動作中のWeb Workbench Hostを実行記録から見つけて再利用するか、無ければplugumi-webを子プロセスとして起動し、その待受URLを `BrowserWindow` で開く。

```sh
pnpm --dir apps/electron start --core http://127.0.0.1:7700
```

`--core` は起動するplugumi-webへ転送される。一つだけなら `PLUGUMI_CORE_URL` でも指定できる。`PLUGUMI_TOKEN` も環境変数として引き継がれる。CoreのURL追加やProject以下の保存はすべてWeb Workbench Host側で行われるため、画面から追加したCoreは `plugumi/web.json` に、Projectは `~/.plugumi/web/` に保存される。

起動するplugumi-webバイナリは `PLUGUMI_HOST_BIN` で指定できる。無ければリポジトリ（`PLUGUMI_REPO`、未指定なら配置からの相対位置）の `apps/web` から `go build` してキャッシュへ置く。既に動いているWeb Workbench Hostがあれば子プロセスは起動せず、そちらを再利用する。

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

---
type: guide
title: MVPのビルドと起動
description: Core（Go）と最小Plugin（standard/Rust・agent/TS）のビルドと、3プロセスでの疎通確認手順。
status: deprecated
relations:
  contract:
    - '00001'
    - '00002'
    - '00003'
---

> 旧Core起点のv1試作の履歴。現行版は[Plugin起点のビルドと接続](00002-run-plugin-clients.md)を参照する。

## 対象読者と前提条件

MVP実装をローカルで動かす開発者。Go 1.26以上、Rust（Cargo）、Node.js 24以上、pnpmが必要。Agentで使うpnpmのバージョンは `plugins/agent/package.json` の `packageManager` に記載している。

## ビルド

```sh
(cd core && go build -o plugumi ./cmd/plugumi)
(cd plugins/standard && cargo build --locked)
(cd plugins/agent && pnpm install --frozen-lockfile && pnpm run build)
```

### Agentをグローバルにインストールする

リポジトリのルートから、Agentをパッケージにして手元にインストールできる。レジストリへの公開は不要。

```sh
cd plugins/agent
pnpm install --frozen-lockfile
pnpm pack
pnpm add -g ./plugumi-agent-0.1.0.tgz
plugumi-agent --help
```

インストール後は別のディレクトリからも `plugumi-agent` で起動できる。pnpmがグローバルの実行ファイル用ディレクトリを見つけられない場合は、`pnpm setup` を実行して端末を開き直す。

## Coreの使い方

```sh
cd core
./plugumi serve     # 前面で起動
./plugumi start     # macOS/Linuxなどでバックグラウンド起動
./plugumi tui       # 管理TUI（後述）
./plugumi stop      # 起動中のローカルCoreが1台の場合に停止を要求
./plugumi plugins   # 登録済みと起動中のローカルPluginを一覧
./plugumi plugins add standard --command "cd plugins/standard && cargo run"
./plugumi plugins start standard    # catalogのcommandをバックグラウンド起動
./plugumi plugins rm standard       # 登録だけ消す（プロセスは止めない）
```

`plugins` の一覧は2系統を併記する。catalog（`~/Library/Application Support/plugumi/plugins.json` 等のconfigディレクトリ）に登録した定義と、起動中のPluginが自己登録したregistry記録。`add` は `--endpoint`（外部起動の接続先）と `--command`（plugumiからの起動コマンド）のどちらか、または両方を取る。登録しただけでは起動しない — `start` またはTUIで選んで有効にする。

`serve` と `start` は同じ設定でCoreを起動する。`serve` は端末上で動き続ける。`start` はCoreを端末から切り離し、待ち受けを開始した時点でURL・PID・ログファイルのパスを表示して終了する。Pluginはどちらのサブコマンドでも起動しない。

既定の待受は `http://127.0.0.1:0`。ポート `0` では起動ごとにOSが空きポートを割り当てるため、同じ設定で `start` を繰り返して複数のCoreを起動できる。固定したいときは `start --port 7700` または `serve --port 7700` のように指定する。指定したポートが使われていれば起動に失敗し、既存のプロセスは止めない。

複数のCoreが起動しているときは、`plugumi stop http://127.0.0.1:7700` のように対象のURLを指定する。停止の対象は、同じマシンで同じOSユーザーが起動したCoreだけである。Plugin自体は停止しない。更新前のバイナリで起動したCoreが `stop` に対応していない場合は、起動時に表示されたPIDを `kill <PID>` に渡すか、前面起動なら `Ctrl+C` を使う。

### 設定 `plugumi.json`

`--config` を省略すると、カレントディレクトリに `plugumi.json` がある場合だけ読み込む。ファイルがなければ、既定の待受URLと空のPlugin一覧で起動する。

```json
{
  "core": { "url": "http://127.0.0.1:0" },
  "plugins": []
}
```

- `core.url`: Coreの管理REST APIの待受URL（省略可）。`http://<loopback-host>:<port>` を指定する。`--port` はポートだけを上書きする。MVPの管理APIは人間・UI Host向けで、認証を持たないためloopbackで待ち受ける
- `plugins[]`: 静的なPlugin Endpoint一覧。付属の設定では空。設定する場合は、Coreが接続できる `http://<host>:<port>` または `https://<host>:<port>` を指定する。Endpointに末尾の `/`、query、fragmentは付けない

### Coreが提供する操作（管理REST・Plugin向けではない）

| 操作 | 内容 |
|---|---|
| `POST /v1/plugins` `{endpoint}` | Plugin Endpointを動的登録（Link確立は非同期） |
| `POST /v1/plugins/remove` `{endpoint}` | Plugin Endpointの登録解除（Link失効・再試行停止） |
| `POST /v1/plugins/list` | 登録済みEndpoint一覧（linkId/pluginId付き） |
| `POST /v1/tools/list` | 登録中の全Tool（人間・UI Host向け確認用） |
| `GET /v1/call` | Tool呼び出し用WS接続（caller向け。後述） |
| `GET /openapi.json` | OpenAPI 3.1 spec（`/openapi.yaml`も） |
| `GET /docs` | API仕様の閲覧画面（Stoplight Elements） |

### 管理TUI（`plugumi tui`）

`plugumi tui` は常駐3ペイン構成。`Cores` は同じマシンで同じOSユーザーが起動したCore、`Plugins` はcatalog（登録済み定義）と実行中registryを併せた一覧（`plugumi plugins` と同じ情報）、`Detail` はCoresでフォーカス中のCoreに張られたLinkとそのToolを木構造で映す。TUIを開くだけではCore・Pluginとも起動も選択もしない。`↑` / `↓` でCoreにフォーカスを移すと即座にpreviewが開く。

端末幅が80列以上なら3ペインが横に並び、狭い端末ではフォーカス中の1ペインだけが全幅で表示される。表示に必要な最小サイズは32列×16行。`tab` / `shift+tab` でペイン間を巡回し、`1` / `2` / `3` で直接ジャンプできる。マウスでも、clickでフォーカス＋選択、double-clickで起動、wheelでスクロールできる（マウスレポート中はテキスト選択がOption+drag等の修飾キー付き操作になる）。

`1 Cores` で `a` を押すと、新しいCoreを空きポートでバックグラウンド起動する。`d` → `y` で停止、`R` → `y` で記録済み設定のまま再起動する。TUIを閉じても、起動したCoreは動き続ける。

`2 Plugins` の各行はcatalog定義と実行中Pluginを名前で突き合わせたもので、実行中はURL、未起動は `stopped` と定義（endpointかcommand）を表示する。`enter`（またはdouble-click）は行の状態に応じて有効化する — 実行中ならCoresでフォーカス中のCoreへLink、command持ちの未起動ならplugumiが起動、endpointだけの未起動ならその場所へLinkを試す。`a` で `名前 endpoint` または `名前 command` を登録（URLだけなら登録せず即Link）。`d` はcatalog登録だけを消し、実行中プロセスとCore側Linkには触れない。`l` はPlugin自身がregistryに記録したログをDetailペインに開く（`esc` で閉じる）。Link解除は `3 Detail` のLINKSで対象を選んで `d` → `y`。

`3 Detail` のLINKSはCoreのLinkを親、そのPlugin由来のToolを子にした木。Link行で `enter` を押すと最初のToolへ降り、Tool行で `enter` / `c` を押すとdetailペイン内でTool callランナーが開く（`←` / `h` でLink行へ戻る）。JSON入力して `ctrl+s` で送信、`esc` で閉じる（実行中ならcloseを送ってから再度押す）。`?` でキー一覧と簡単な説明をdetailペインに表示する。

既定のポート `0` で複数のCoreを試すには、同じ端末で次を実行する。

```sh
./plugumi start
./plugumi start
./plugumi tui
```

TUIの `--config` は、新しいCoreを起動するときだけ使う。省略時はカレントディレクトリの `plugumi.json` があれば読み込み、なければ既定値を使う。どちらの場合もポートを `0` に上書きする。

| キー | 動作 |
|---|---|
| `tab` / `shift+tab` | ペイン間を巡回（`1` / `2` / `3` で直接ジャンプ） |
| `↑` / `k`、`↓` / `j` | 選択を移動。Coresではフォーカスにpreviewが追従する（`pgup` / `pgdown` で10項目ずつ） |
| `←` / `h` | DetailペインのTool行から親Link行へ戻る |
| `enter` | CoresではDetailペインへ移動。Pluginsでは行を有効化（Linkまたはstart）。DetailのLink行ではToolへ降り、Tool行ではcallを開く |
| `a` | Coresでは新しいCoreを起動。Pluginsでは `名前 endpoint|command` の登録入力 |
| `d` → `y` | Coresでは選んだCoreを停止。DetailのLINKSでは選んだLinkを解除（`esc` で取消）。Pluginsでは登録解除（確認なし・プロセスは止まない） |
| `l` | Pluginsでは選んだPluginのログをDetailペインに表示 |
| `R` → `y` | 選んだCoreを記録済み設定で再起動 |
| `ctrl+s` | callランナーでJSON inputを送信（空=入力なし） |
| `esc` | 入力・確認・callを抜ける。実行中callならcloseを送ってから再度押す。通常時は1ペイン戻る |
| `?` | Detailペインにキー一覧を表示 / 閉じる |
| `r` | 全一覧の手動更新（2秒ごとの自動更新もあり） |
| `q` / `ctrl+c` | 終了 |
| mouse click | ペインのフォーカス＋行選択（double-clickで起動） |
| mouse wheel | カーソル下のペインをスクロール（call中は出力をスクロール） |

caller channel（`GET /v1/call`）はcontracts/00003のcaller側プロトコルをそのまま喋るWS。TUI以外のcaller（スクリプト・将来のUI Host）も同じ経路を使える。

### 動作モデル

- Coreは `POST /v1/link/hello` でLinkを確立しlinkId（UUID）を払い出し、`GET /v1/tools` でTool宣言をpullする。`GET /v1/transport` のWS upgradeはTool呼び出し用のみ
- Coreは `POST /v1/tools/catalog` で全Tool一覧をPluginへpushする
- **PluginはCoreのURL・Domainを知らない**。全てCore→Pluginの接続で、Pluginは受け答えだけを行う
- transport切断 = Link失効。再接続は `POST /v1/link/hello` からやり直し（新linkId）
- `POST /v1/link/ping` が90秒成功しないとLink失効（半開き検出用）
- 1つのPluginに複数Coreが接続してよい（`core.id` 別のLinkが共存する）

## 手順

1. Core を起動: `cd core && ./plugumi serve --port 7700`（後続のREST例で同じURLを使うため固定）
2. standard Plugin を起動: `cd plugins/standard && cargo run`
3. agent Plugin を起動: `cd plugins/agent && pnpm start`（グローバルにインストール済みなら `plugumi-agent`）。待ち受け開始後にstdinコマンドループが開く。
4. 各Pluginが `listening on` に表示したURLをCoreに登録する。TUIでは `1 Cores` でCoreをフォーカスしてから `2 Plugins` で対象を `enter`、または `a` でURLを入力する。起動中のPluginはローカルregistryに登録されるので、URLをコピーしなくても一覧から選べる。

引数なしでは、両Pluginとも[ローカルPluginの待ち受け仕様](../contracts/00001-core-plugin-transport.md#ローカルpluginの待ち受け)に従い、OSが空きポートを割り当てる。固定ポートが必要なときは、standardなら `cargo run -- --port 9001`、agentなら `pnpm start --port 9002` または `plugumi-agent --port 9002` と指定する。

ホストも指定する場合は `--port` の代わりに `--listen http://<host>:<port>` を渡す。従来どおり、URLを位置引数として渡すこともできる。PluginはTLS未実装のため、待受URLに `https://` は指定できない。

PluginはCoreを知らない。Coreが `POST /v1/link/hello` でLinkを確立し `GET /v1/tools` でTool宣言を取りに来る。PluginはREST応答とWS upgradeの受付だけを行う。

## Pluginの管理

複数のCoreサーバーを同時に起動できる。Pluginの起動・停止は、どのCoreにも従属しない。各Coreは、登録されたPlugin Endpointに接続する。登録はPluginを起動する操作ではない。

### 起動中のPluginを一覧する

ローカルで起動したPluginは、待ち受け開始時に自分をローカルregistryへ登録する（contracts/00001「ローカルPluginの自己登録」）。`plugumi plugins` で、起動中のPluginの名前・URL・PIDを確認できる。ここに出るのは生きているPluginだけで、Coreとの接続の有無とは無関係である。

```sh
plugumi plugins
```

Coreに登録するEndpointには、この一覧のURLか、Pluginの起動時に表示されたURLを使う。

たとえば、Core AとCore Bが同じPluginに接続しているとき、Core Aで登録を解除すると、切断されるのはCore Aとの接続だけである。Pluginは動き続け、Core Bとの接続も維持される。

### 実行中のCoreにPlugin Endpointを登録する

実行中のCoreに管理RESTで追加する例。`54321` は例なので、Pluginの起動時に表示されたポートに置き換える。

```sh
curl -X POST http://127.0.0.1:7700/v1/plugins \
  -H 'content-type: application/json' \
  -d '{"endpoint":"http://127.0.0.1:54321"}'
```

登録は受理のみで、Link確立は非同期（Coreが再試行しながら接続を試みる）。登録済み一覧は `POST /v1/plugins/list`。

動的登録はランタイムのみ（Coreの再起動で消える）。毎回同じEndpointを使う場合はPluginを固定ポートで起動し、`plugumi.json` の `plugins` にそのURLを書く。空きポートで起動したPluginを再起動してURLが変わった場合は、新しいURLを登録し直す。

## 期待される結果

`POST /v1/plugins/list` の応答で、各Pluginの `linkId` と `pluginId` を確認する。agentのコマンドループでは、次の操作でcatalog受信とTool呼び出しを確認できる。

```
list                                        # POST /v1/tools/catalogで受け取った全Tool（linkId + toolPath）
call <linkId> echo {"hello":"w"}            # sync: responseに結果
call <linkId> exec {"command":"echo hi"}    # async: 受理response + 途中出力 + 終端result
call <linkId> ticks {"intervalMs":500}      # 購読: closeまで継続
close <callId>                              # 開いているcallを閉じる
call <agentのlinkId> agent/echo {}          # 自己呼び出し（呼び出し元自身をtargetにできる）
```

`fs/write` には、空でない文字列の `input.path` と文字列の `input.content` を渡す。成功時は `path` と、書き込んだUTF-8のバイト数 `bytes` が返る。`content` が省略されているか文字列以外なら `-32000` を返し、対象ファイルへの書き込みは行わない。`content` に `""` を明示すると空ファイルを書き込む。

## トラブルシューティングと制限

- 固定ポートで待ち受けに失敗した場合、`serve` と `start` はエラーで終了する（別のポートには切り替えない）
- Pluginを再起動すると新しい `linkId` が払い出される（link-scoped）
- ping 30秒・失効90秒。Core再起動後はCoreが再dialし、同じ `core.id` の旧Linkは新helloで差し替えられる

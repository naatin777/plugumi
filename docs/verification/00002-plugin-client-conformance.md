---
type: verification
title: Plugin起点のPoCとプロトコル適合シナリオ
description: 待受なしの登録からPanel表示までの縦断経路、再接続、認可、型生成、配備条件の検証計画。
status: draft
relations:
  requirement:
    - '00003'
    - '00004'
    - '00005'
  architecture:
    - '00002'
  contract:
    - '00004'
  design:
    - '00003'
  verification:
    - '00001'
---

## 対象と前提

[採用した接続方針](../decisions/00012-plugin-initiated-connections.md)の合格条件と、[接続契約](../contracts/00004-plugin-client-protocol.md)・[新構成](../architecture/00002-plugin-client-system.md)で比較する方式の検証計画。草案の候補を試すシナリオが通っても、方式を採用したことにはならない。

[旧方式の検証](00001-core-plugin-mvp-conformance.md)を置き換える。

最初は分離したloopback環境でCoreを起動する。用意するのは待受のないCLI Plugin、読み取り専用の購読クライアント、認可済みUI Host、文字列echoのToolとPanel API。二つ目のCore、期限を短くできるテスト設定、接続を切れるテスト用Proxyを異常系で使う。テスト用資格情報と組織・実サービスの資格情報を共用しない。

## 最初の縦断テスト

1. 購読側がSSEに接続し、`registry.reset` 後の空Snapshotを読む。CLI PluginはCore URLを指定されて登録する。購読側が `plugin.added` を受け取る。Pluginは待受ソケットを作らず、CoreからPluginへの発信接続も発生しない。
2. CLI PluginがRESTでechoのTool宣言を登録し、後から変更する。購読側が `tools.changed` と新しいSnapshotを観測する。途中でSSEを切断して更新しても、再購読後に最新内容へ収束する。
3. CLI Pluginが同じ認証主体・登録でWSを開く。呼び出し元が `registrationId + toolPath` を指定してechoを実行し、Coreが対象の既存WSへ配送して結果を返す。Coreは別の対象を選ばない。
4. UI Hostで最小のPanelを表示する。Panel専用のecho操作をBridgeから呼び、Coreが同じPluginへ配送した結果をPanelに表示する。その操作はTool一覧に出ない。UI Hostを閉じてもPlugin自体の接続と他の呼び出し元は継続する。
5. Pluginが登録を取り消す。購読側が `plugin.removed` を受け、Snapshotから登録と宣言が消える。旧登録への呼び出しは失敗する。

## 適合シナリオと失敗条件

| ID | 操作 | 合格の観測 |
|---|---|---|
| C1: 版と認証 | 認証なしで登録、別主体で更新・WS接続、無効な版へ接続、旧v1クライアントを混ぜる | 権限外は状態を変更できない。契約どおりのHTTPエラーを返し、CoreがPlugin Endpointへdialしない。 |
| C2: 登録と期限 | 登録応答だけ失い再送する。WSとSSEを別々に切り、更新と期限満了を試す。さらにCore/Pluginを別々に再起動する | 再送は存続中の登録の期限を延長し、登録IDとRevisionは変えない。SSE切断は登録を消さない。WS切断で配送不可になり、期限内なら同じ登録で復旧。失効後は旧IDを使えず、Core再起動は新しい世代になる。 |
| C3: 変更の競合 | SSE購読直後、Snapshot取得中、切断直後に宣言を更新。古い `Last-Event-ID` で再購読。購読を読み取れなくする | reset後の再読込で収束し、遅れて到着した旧接続のSnapshotで巻き戻らない。Coreが無制限にイベントを溜めない。 |
| C4: 複数Core | 一つのPluginを二つのCoreにつなぎ、同名Tool、同じJSON-RPC IDを使う。片方のCoreだけ停止・再起動 | 資格情報、登録、Snapshot、結果・取消が混ざらない。もう一方のCoreでは呼び出しを継続する。 |
| C5: RPCの障害 | 逆方向も同時に呼ぶ。不正Schema、未知の宛先、期限切れ、取消、配送後の切断や遅い応答を挟む | 区間・方向ごとの相関が保たれる。終端は一度だけ。結果が不明な呼び出しは自動再実行せず、Plugin側の実行回数でも確認する。 |
| C6: Streaming候補 | 受信側を止め、credit内外の出力、取消、終端を競合させる | 受理→順序付き出力→終端。メモリとキューが有界で、制御通知がデータ枠を消費しない。 |
| C7: Bundle・Panel | 複数ファイルの同一版と不正なBundleを渡す。別Panel/他Core宛ての操作、無許可Origin、セッション失効を試す | CSS・画像・フォント・分割JSが解決される。未検証版は公開されない。Panelから親DOM・資格情報・他Panelへ届かず、秘密情報を混ぜない。 |
| C8: 公開経路 | 同一OS、Docker、WSL、LAN、VPN、Tunnelの順にHTTP/1.1、HTTPSのHTTP/2 REST/SSE、WS upgradeを確認 | bindと案内URLを別々に記録し、各環境で到達・不達の理由が分かる。失効後に既存WS/SSEも閉じ、Gateway/Tunnelの経由・迂回で権限が広がらない。SSEの配信遅延も測る。 |
| C9: Media | HTTP/WSが到達する環境でWebRTC直接、直接が使えない環境でTURNを試す | SDP・ICEのSignalingは認可した経路だけを通る。選択されたICE候補ペアを記録し、Mediaの直接／TURN経路を確認する。PluginにHTTPサーバーを追加しない。 |

## 型生成の短い比較試験

- RESTはCoreの `/openapi.json` の `PluginIdentity` と `RegistrationLease` をOpenAPI Generatorで生成する。RPCは[echo JSON Schema](../contracts/plugin-client-v1.echo.schema.json)の入力・出力を使う。RPC生成器は候補のまま。
- Go・TypeScript・Rustで同じ型を生成し、正常な入出力を各言語でコンパイルする。各言語の型検査で、不足フィールドや誤型を検出できるか確認する。生成された型で表現し切れない制約は、受信時の検証が検出することを確認する。
- `{"text":"hello"}` と `{"echo":"hello"}` を正例、`{}` と `{"text":123}`、`{"echo":null}` を対応するSchemaの負例とする。異なる言語間のWSで正常例を往復させる。動的登録されたSchemaをCoreが事前コンパイルせずに検査できるかも観測する。
- 生成器名と版、Go/Node/Rustの版、実行コマンド、生成に失敗したSchemaの機能、型検査と実行時検査の差を記録する。生成物を並べただけでは適合とみなさない。

## 結果と証拠

### ローカルで再実行する

Agentの依存は事前に `pnpm install --frozen-lockfile` で用意する。リポジトリのルートから `pnpm --dir plugins/agent test` を実行するとAgentのテストが動く。実プロセステストも含める場合は、CoreとStandardをビルドして次のように実行する。

```sh
(cd core && go build -o plugumi ./cmd/plugumi)
(cd plugins/standard && cargo build --locked)
(cd plugins/agent &&
  PLUGUMI_TEST_CORE="$PWD/../../core/plugumi" \
  PLUGUMI_TEST_STANDARD="$PWD/../standard/target/debug/plugumi-standard" \
  pnpm test)
```

[実プロセステスト](../../plugins/agent/test/plugin-clients.integration.test.mjs)では、StandardとAgentをCore 2台に接続する。片方を再起動すると両Pluginが新しい登録で呼び出しを受け付け、もう片方では同じ登録で途中出力と取消が続くことを確認する。C4とC5の一部を検証するもので、TCP待受の不在や実行回数による再実行チェックはこのテストの対象外。

### 実行記録

Registryの整理後、Coreのテストで、定期掃除前でも期限切れの登録に配送できないことと、Snapshotから除外する際にRevisionが進むことを確認した。上記の実プロセステストもmacOSで通過した。HumaのOpenAPI出力は整理前後で一致した。

Coreの自動テストで、SSE通知、登録の冪等性、Toolの往復、WS切断後の登録維持と再接続、旧パスの拒否を確認する。Agentの自動テストでは、SSEからの一覧更新とWS再接続を確認する。Panel、Bundle、外部公開、WebRTC、RPC型生成の適合試験は未実施。

2026-11-20、macOSで実プロセスのCore 2台に同じStandardとAgentを接続した。PluginにTCP待受がないこと、Toolのechoとticksの途中出力・取消、片方のCore再起動で両Pluginが再登録し、もう片方のRegistryが変わらないことを確認した。

同日、Coreが生成した `/openapi.json` をOpenAPI Generator 7.16.0で検証し、Go・TypeScript (`typescript-fetch`)・RustのRESTクライアントを生成した。Goのクライアント本体は `go build .`、TypeScriptは `tsc --strict --noEmit` に合格した。Goの生成テストとRustの生成物のビルドは、生成側の依存がローカルに揃わず未確認。生成クライアントを使った疎通は未実施。

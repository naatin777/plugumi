---
type: design
title: Core起点の試作からPlugin起点への移行
description: 現行コードと旧契約の差分、互換性を切る範囲、移行順と切替条件を記録する。
status: draft
relations:
  requirement:
    - '00002'
    - '00003'
    - '00004'
    - '00005'
  architecture:
    - '00002'
  decision:
    - '00012'
  contract:
    - '00004'
  design:
    - '00001'
    - '00002'
---

## 現行調査と差分（2026-11-20）

対象は本リポジトリのREADME・SpecbookとGo Core、Rust Standard、TypeScript Agent、および作業ツリーにあるTUI・プロセス管理の変更。旧PlugumiやSlopDockの実験結果はこの調査の証拠に含めない。旧[システム構成 00001](../architecture/00001-system-structure.md)と旧[契約 00001–00003](../contracts/00001-core-plugin-transport.md)は、今回までの試作を説明する資料として残す。

| 論点 | 依頼時の文書・コードで確認した事実 | 移行先 |
|---|---|---|
| 接続・起動 | 旧Decision 00004・00007・00010はCoreからPluginへの接続を前提としていた。旧Connectorは設定・動的登録からPlugin Endpointを保持し、`hello → tools pull → WS dial` を試行していた。Environment ProviderとAgentはそれぞれ待受サーバーを持っていた。 | PluginにCore URLを渡し、Plugin側が登録・購読・WS・再接続を担う。起動補助は任意。 |
| Registryと宣言 | 旧Design 00001・00002ではLinkに宛先と宣言を置いた。Coreは `GET /v1/tools` で取得し、`POST /v1/tools/catalog` でPluginに一覧をpushした。WS終了でLinkを外した。 | Pluginが宣言を書き込む。Coreの[Registry](../../core/internal/registry/registrations.go)がLease・宣言・RPC接続を管理し、SnapshotとSSEを提供する。WSが切れても、Leaseが有効な間は登録を保持する。 |
| caller・RPC | 旧 `/v1/call` は非Plugin用のWSで、RouterがPlugin接続との間を中継していた。旧Decision 00011と旧Tool契約はLinkとcaller channelを区別する。 | Routerの相関・中継という責務を残し、宛先は `registrationId` に切り替える。Panel APIの限定配送は後続の検証対象。 |
| Core管理・ローカル検出 | [TUI](../../core/internal/tui/plugins.go)はOSユーザーのローカル記録とprobeで実行中Pluginを検出し、選んだCoreへPlugin Endpointを追加する。ローカルカタログと起動コマンドも扱う。Plugin自身がローカル記録を書くことは、Coreへのプロトコル登録とは異なる。 | 接続一覧は選択中のCoreから取得する。Coreの起動・停止・ログ・ローカル設定は通信から独立して残せる。ローカルPluginの検出にHTTP待受を要求しない。 |
| Panel・外部アクセス | 旧接続契約はPanel通信を対象外としていた。Bundle配信、Panel認可、WebRTCの共通経路はない。 | [新構成](../architecture/00002-plugin-client-system.md)の候補を別々に検証する。Coreはloopback限定を維持する。 |

[旧検証記録](../verification/00001-core-plugin-mvp-conformance.md)には旧 `hello`、WSとLink失効、catalog push、TUIのcaller経路の手動結果がある。新方式の観測は新しい[適合シナリオ](../verification/00002-plugin-client-conformance.md)に分ける。

## 合意済みの変更と互換性

[Decision 00012](../decisions/00012-plugin-initiated-connections.md)が接続の方向と責務を決める。この移行計画は旧Tool登録設計・Link Registry設計を置き換える。

**切替方針:** 開発中の `/v1/` を直接置き換える。旧 `hello`・`ping`・`transport`・`tools/catalog`、Endpoint登録API、`/v1/call` の互換層は作らない。旧・新バイナリを混ぜず、Core・Standard・Agent・TUIを一緒に更新する。

`plugins[].endpoint`、ローカルカタログのEndpoint、`--listen` 等をCore URLに自動変換しない。Endpointは逆向きの宛先なので変換できない。新しいPluginにはCore URLを改めて指定する。旧 `linkId` や保存済み宛先を新登録に引き継がず、Snapshotを取り直す。Coreの起動設定・ログ・TUIの表示操作など、v1 wireに依存しない操作は維持する。起動コマンドからの資格情報の渡し方は別途設計し、URL・ログ・コマンド履歴へ入れない。

## 段階と合格条件

| 段階 | 変更順・範囲 | 次へ進む条件 |
|---|---|---|
| 1. ローカル縦断PoC | Coreで受信側REST・SSE・WSを作る。新旧のRegistryを暗黙に混ぜない。待受を持たない小さなCLIを使い、`登録 → SSE受信 → RESTでTool宣言を更新 → WSでecho → 最小Panelに結果を表示` をつなぐ。Panelには固定の信頼境界内で、同じecho契約を使うPanel専用操作も一つ用意する。 | Plugin待受なしで一往復できる。SSE再接続で表示が収束し、Tool一覧にPanel APIが現れない。旧実装の公開範囲は変更しない。 |
| 2. 実PluginとTUI | Go RPCのEnvelope処理と中継責務を再利用候補にし、登録・接続の責務を分離する。次にEnvironment ProviderのTool実装を保って通信面をClientに置き換え、Agentはcatalog pushの代わりにSnapshot＋SSEを使う。TUIのCore選択とログ操作を保ち、選択先のRegistryを表示する。 | 複数Core、再登録、スコープ分離、エラー、取消、順序・負荷試験に合格する。Streaming拡張を入れる場合は受理・出力・終端の順序を再検証する。 |
| 3. UI Bundle・型 | 複数ファイルのビルド成果物の受付と配信を追加。ブラウザの分離とBridgeを検証する。HTTP・RPCの型生成をGo・TypeScript・Rustで比較する。 | CSS・動的import・画像・フォントが動き、親や他Panelの権限には届かない。生成型と実行時Schemaの整合を確認する。 |
| 4. 外部到達・Media | Docker/WSLから順に試し、LAN、VPN、認証付きTunnelへ進む。MediaはSignalingと別に直接・TURN経路を確認する。 | 成功経路だけでなく、未認証・未登録・失効、SSE/WSプロキシ、Media非到達を観測できる。認証・認可・監査の設計が済むまで外部公開しない。 |
| 5. 切替 | 新しい利用手順を実測して更新する。旧試作は置換後に別変更で退役させる。 | 新しいクライアントとCoreの組合せで[適合シナリオ](../verification/00002-plugin-client-conformance.md)を実施。旧接続の手順・制約・証拠は履歴として残す。 |

## 未決事項・検証が必要な仮説

TUIが従来の「選んだPluginを選んだCoreへ接続する」操作をどこまで提供するかは未決定。既に動くPluginへ任意のCore URLを渡す共通プロトコルは設けず、まずPlugin側で操作できることを確かめる。任意の起動支援を残す場合も、接続先を明示できるローカルコマンドに限って評価する。

PoCで、既存のTool実装・RPC中継・TUIの実行管理を保ったまま、Plugin待受とCoreのEndpoint取得ループを外せるかを確認する。互換層や抽象化を先に増やさない。契約の未決事項は[接続契約](../contracts/00004-plugin-client-protocol.md)、運用・UI・Mediaの未決事項は[システム構成](../architecture/00002-plugin-client-system.md)を正本とする。

---
type: decision
title: PluginがCoreへ接続する
description: Coreを共通の接続先とし、既存CLIやアプリの拡張が待受サーバーなしで参加できるようにする。
status: accepted
relations:
  requirement:
    - '00003'
    - '00004'
  decision:
    - '00004'
    - '00007'
    - '00010'
    - '00011'
---

## コンテキスト

旧方式では、Coreから到達できるHTTP/WSサーバーをPluginごとに用意する必要があった。既存CLIの拡張やDocker・WSL内のプロセスをつなぐとき、待受ポートの公開やCore側のEndpoint設定が負担になる。外部サービスと連携するPluginも、標準形は提供者の公開URLではなく、利用者が管理する環境で動くCLIやAdapterとする。

## 合意済みの方針

- CoreがHTTPサーバーを提供する。Pluginは利用者やCLI設定からCore URLを受け取り、自ら登録・接続・再接続する。CoreはPluginが開始した接続を通じて、そのPluginへの呼び出しを配送する。
- PluginにHTTP/WS待受、独自ドメイン、Coreによる起動・停止を要求しない。既存アプリのサーバー、開発用サーバー、任意のローカル起動支援は禁止しない。
- 同じPluginプロセスが複数Coreに接続できる。接続先の選択とPlugin内の業務状態の共有・調停はPluginの責務とする。Coreは他のCoreの登録や配送を前提にしない。
- Coreは明示的な登録解除を受け付けたら、直ちに登録を削除する。RPC接続が切れただけなら配送を止め、登録は期限まで保持する。期限内に再接続したPluginは同じ登録を使える。
- CoreはAI非依存の共通基盤とする。Toolの選択は呼び出し元に残す。AIに公開するToolとPanel専用APIは別の契約とし、共通の配送基盤を使っても権限を共有しない。
- 用途に応じてREST/OpenAPI、SSE、WebSocket RPCを併用する。HTTP StreamingやWebRTCを排除しない。Panel操作はCore仲介を第一候補とし、UIは複数アセットを扱う。メディアを提供する場合はSignalingとMediaを分ける。
- 既存CLIの外部サービス認証を再利用できる。外部サービスの資格情報と、CoreがPluginやブラウザに付与する権限は別に扱う。運用の主対象は利用者または組織が管理する環境とする。
- 開発中のv1を直接置き換える。別版や旧方式へのフォールバックは提供しない。

## 代替案と帰結

CoreがPluginへ接続する方式では再試行をCoreに集約でき、PluginはCore URLを持たずに済む。その代わり、Pluginごとの到達性と待受の実装が必要になる。Pluginが接続する方式では必要な到達性をCore側に集約できるが、PluginやSDKに認証・再接続が必要になる。第三者のPlugin URLをCoreが探索・呼び出しする方式や、旧方式と新方式の恒久的な併用は基本形にしない。

RPC接続の切断だけでは、Pluginが登録をやめたのか、一時的に通信できなくなったのかをCoreは判別できない。切断と同時に削除するほうが単純だが、短い通信断でも登録IDが変わる。期限付きで保持すれば同じ登録で復帰でき、強制終了などで解除が届かなかった登録も期限が来れば消える。

## 置き換える決定（supersedes）

| 旧Decision | 置き換える範囲・引き継ぐ考え方 |
|---|---|
| [00004](00004-mvp-connection-and-lifecycle.md) | 接続方向、Endpoint管理、Linkと接続の寿命を固定する前提を置き換える。プロセス起動と接続の分離、CLI/TUIでの観測、`core/` と `plugins/` の分離は維持する。 |
| [00007](00007-transport-selection.md) | 旧方式の二系統の境界を置き換える。RESTとJSON-RPCの使い分けは維持し、Registry購読にはSSEを加える。 |
| [00010](00010-plugin-passive-ws.md) | Pluginの受動待受、Coreからのhello・ping・宣言取得、Tool専用WSという構成を置き換える。 |
| [00011](00011-caller-channel.md) | `/v1/call` と旧Linkを基準にした接続種別を置き換える。非Pluginクライアントも明示的な権限でToolを呼べる考え方は維持する。 |

[00001（信頼モデル）](00001-plugin-trust-model.md)のローカル実行コードの採用判断と、Core接続認可・ブラウザでのコード隔離は別問題。[00003（配布・運用）](00003-distribution-and-operations.md)のCLI活用と任意のUI Hostは維持するが、Webの配信入口は未決定とする。

## この決定に含めないこと

登録期限の長さや更新方式、切断中の登録のTUIでの表示方針は、このDecisionでは決めない。Web Gateway、PanelのOrigin・Bridge、RPCスキーマ形式、メディア中継、ネットワークProviderや認証基盤も対象外とする。候補・失敗条件は[システム構成](../architecture/00002-plugin-client-system.md)、具体的な通信案は[接続契約の草案](../contracts/00004-plugin-client-protocol.md)を参照。

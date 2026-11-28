---
type: decision
title: Web appがブラウザとCoreを仲介する
description: ブラウザ向けUIをCoreではなくWeb appが配信し、複数Coreへの接続をWeb appに集める。
status: draft
relations:
  requirement:
    - '00003'
    - '00004'
  architecture:
    - '00003'
  decision:
    - '00012'
    - '00017'
    - '00029'
  contract:
    - '00004'
---

## コンテキスト

[Decision 00012](00012-plugin-initiated-connections.md)では、Webの配信入口を未決定とした。旧[システム構成 00002](../architecture/00002-plugin-client-system.md)は、PoCの推奨案を「A: Coreが配信」とし、「B: Web PluginがGatewayを提供」は比較対象にとどめていた。

利用者は、1つのブラウザ画面から複数のCoreを切り替えて使いたい。Coreが配信する案では、Coreごとに別のOriginとなり、Core一覧の画面を置く場所がない。また、現行のCoreは `Origin` ヘッダー付きのリクエストを拒否するため、ブラウザから直接呼び出せない。

現行モデルではWeb appはPluginではなく公式UI Appである。ただし、browser向けにはHTTP serverが必要であり、このserverがブラウザとCoreの間を仲介する実装は維持する。

## 決定

- ブラウザ向けのUIは、`apps/web/` のWeb appが提供する。Web appはinstallable pluginではなく公式UI Appである。
- Web appはブラウザ向けのHTTPサーバーを持つ。ブラウザはWeb appにだけ接続し、Coreへの通信はWeb appのサーバーが代わりに行う。サーバーはGo、フロントエンドはSolidで実装する。
- Web appは接続先のCoreを、起動コマンドの `--core` と、画面から追加された一覧の両方から受け取る。画面から追加した一覧はWeb appが保存する。
- URLでCoreを指すときは、Coreが返すCore名を使う。Core名はCoreの設定（`core.name`）で決め、公開APIの `GET /v1/core` で返す。Web appは独自の名前を付けない。
- Web appの待受は、Coreと同じくloopbackに限り、既定のポートは `0`（OSが選ぶ）とする。
- Web appがbrowser clipboard、browser notification、web-native file pickerなどのapp-local operationを提供する場合は、app-local operationとしてCoreへ登録する。UIを配信するためのserver機能そのものはPlugin登録ではない。

## 代替案

| 案 | 採らない理由 |
|---|---|
| Coreが静的ファイルを配信する（00002の案A） | 複数のCoreを1つの画面で切り替えられない。Core一覧の画面を置く場所がない |
| Coreごとの名前をWeb appが付ける | Coreを再起動すると `coreId` が変わるため、Web appだけでは同じCoreと判定できない。TUIやCLIでも同じ名前を使えない |
| Core名を内部用の `/_plugumi/instance` で返す | 契約の外にある入口にUI Appが依存する。リモートのCoreでは使えない |

## トレードオフと帰結

- Web appはブラウザ向けの待受を持つ。Decision 00012はProviderにHTTP/WS待受を要求しない決定であり、公式UI Appがbrowser向けserverを持つことと矛盾しない。
- ブラウザからCoreへの認証や、操作者ごとの権限をCoreへ伝える方法は、Web appの責務になる。00002が挙げた案Bの失敗条件（Gatewayの広い権限で、操作者ごとの認可を迂回する、など）は引き続き当てはまる。現時点ではloopback限定のため、Web appは `PLUGUMI_TOKEN` をそのまま使う。
- Panelの隔離（Originの分け方、iframe、Bridge）はこの決定では決めない。Core名を `<name>.localhost` のサブドメインに使い、Coreごとに別のOriginにする案は、Panelを隔離する段階で検討する。
- 00002の「Webの表示入口」の推奨案は、この決定で置き換える。ただし、Web appのserverをElectron appへ同梱するかなどの配布形態は[Decision 00015](00015-electron-plugin-shares-plugin-shell.md)と別途決める。

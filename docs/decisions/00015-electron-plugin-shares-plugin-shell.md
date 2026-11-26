---
type: decision
title: Electron appはWeb appとWorkbench shellを共有し、Electron固有のserverを持たない
description: Electron appを、Web appと同じWorkbench shellを表示するUI Appとする。Core接続・保存・UI取得のserver側実装はWeb app側へ寄せ、Electron固有の重複実装を持たない。
status: draft
relations:
  decision:
    - '00013'
    - '00014'
    - '00017'
    - '00029'
  architecture:
    - '00003'
  design:
    - '00004'
  requirement:
    - '00003'
    - '00004'
---

## コンテキスト

ブラウザ向けの画面はWeb appが提供し、Web appのGoサーバーがブラウザとCoreを仲介する方向で実装している。

Electronでも、Web appと同じ画面（Workbench shell、Panel、OS領域）を使いたい。当初はElectronのmainプロセスが自らCoreへ接続・登録し、preloadのIPCで `ShellHost` を実装する別のPluginとして作った。その結果、Web appのGoサーバーが担う処理（登録とLeaseの更新、operation呼び出し、Project以下の保存、PanelのUIファイルの取得）をTypeScriptで複製することになり、2つの実装のずれを文書で抑える必要があった。

現行モデルではElectron appはPluginではなく公式UI Appである。ただし、Electron native browserやwindow操作などのapp-local operationは、UI App operationとしてCoreへ登録する。

## 決定

- Electron appは、`apps/electron/` に置く公式UI Appである。画面表示のためのElectron固有serverは持たず、別processとして配布・起動されるWeb app側serverがloopbackで配る画面を `BrowserWindow` で開く。登録・保存・UI取得はWeb app側のserver実装に任せる。
- この方針はprocess ownershipをElectron appへ移す意味ではない。Electron appはCore DaemonやPlugumi管理のPlugin runtime processを直接所有せず、管理操作はDaemon management API経由で行う。
- Web app側のserverは実行記録（`<cache>/plugumi/plugins/<id>.json`）に待受URLを `url` として書く。Electronのmainプロセスは記録を読み、`GET <url>/api/cores` が200を返すhostを再利用する。見つからなければplugumi-webを子プロセスとして起動する（バイナリは `PLUGUMI_HOST_BIN` で指定する）。再利用したhostは終了時に止めず、自分が起動した子プロセスだけを終了時に止める。
- 画面はWorkbench shell（`shared/workbench`）として共有する。Web appの配るページをそのまま読み込むので、`ShellHost` の実装はHTTP（`/api`）の1本だけになり、preloadのIPC実装や `plugumi-ui://` プロトコルは持たない。
- Areaを別windowに出す（detach）とタイトルバー装飾のテーマ連動だけはpreloadのIPCで行う。preloadは `window.plugumiWindows.open(path)` を公開し、mainプロセスは `plugumi:open-window` で受けたpathをhost URLで開く。テーマはrendererの `plugumi:theme` DOMイベントをpreloadが `plugumi:theme` IPCへ中継し、mainプロセスが `titleBarOverlay` に反映する。
- detachはElectron専用の操作とする。Web側の `ShellHost.windows` はpreloadのbridgeがあるときだけ非nullになり、ブラウザでは別windowへ出す操作を出さない。
- Project以下の保存はWeb app側の `~/.plugumi/web/` に一本化する。Electron独自の `~/.plugumi/electron/` は廃止し、Electron app自身のCore接続・保存・UI取得のTypeScript実装は削除する。
- ウィンドウは `BrowserWindow` に `titleBarOverlay` を指定する。ElectronはこのときWindow Controls OverlayのCSS環境変数を提供するので、PWAと同じOS領域のCSSを使える。
- Electron appがCoreへ登録するUI App operationは、Electron固有の能力に限る。例はwindowの開閉・一覧・フォーカス・描画内容の取得、native browser、OS統合である。同じ由来のPanel（`apps/electron/ui` のWindows Panel）もUI bundleとして登録してよい。

## 代替案

| 案 | 採らない理由 |
|---|---|
| ElectronのmainプロセスがPluginとしてCoreへ接続・登録する（当初の実装） | Web appと同じ処理をTypeScriptで複製することになり、接続・保存・UI取得のずれを2実装で管理し続ける必要がある。Electron appをPluginとして扱う現行モデルとも合わない |
| 画面もElectron用に別に作る | 同じ画面を2つ保守することになる |
| Electron appにWeb appのGoサーバーを内部componentとして同梱して起動する | serverの更新・診断・複数UI Appからの再利用をElectron appへ閉じ込めやすく、責務が分かれない。配布時もWeb app側serverは別processとして扱う |

## トレードオフと帰結

- Coreへの接続、保存、UIファイルの取得はWeb app側のGo実装1本になる。Electron側のTypeScript backend（約1,100行）は削除した。
- Electron appのUI App operation接続は、viewerとして開いているhostの `GET /api/cores` に追従し、Coreごとに張る。TypeScript側の接続機構（registration・RPC・実行記録・UI bundleの登録）は現行実装では `packages/plugin-client` を使うが、このpackageはlegacyであり、今後のclient library分割で置き換える。
- 現行の開発構成では、Electron appはWeb app側serverなしには動かない。viewerがhostを起動・発見するため、利用者が意識する必要はないが、Web app側serverが起動できない環境ではElectron appも使えない。配布時もserverはElectron appへ同梱せず、別processとして配布・起動する。install物の粒度と更新方法は別途決める。
- 保存先を分けないので、Web appで作ったProjectはElectron appにもそのまま出る。
- 依存として `electron` の追加を承認済み。ビルドの補助ツールや配布用のパッケージ作成ツールは、必要になったときに改めて決める。
- `BaseWindow` と `WebContentsView` の組み合わせでは、Window Controls OverlayのCSS環境変数が取れないという報告がある。そのため、`BrowserWindow` を使う。

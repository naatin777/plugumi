---
type: decision
title: Electron PluginはWeb PluginとPlugin Shellを共有し、サーバーを持たない
description: Electron Pluginを、Web Pluginの配る画面を開くだけのviewerとする。画面はPlugin ShellとしてWeb Pluginと共有する。
status: draft
relations:
  decision:
    - '00013'
    - '00014'
  architecture:
    - '00002'
  design:
    - '00004'
  requirement:
    - '00003'
    - '00004'
---

## コンテキスト

[Decision 00013](00013-web-plugin-gateway.md)で、ブラウザ向けの画面はWeb Pluginが提供し、Web PluginのGoサーバーがブラウザとCoreを仲介すると決めた。

Electronでも、Web Pluginと同じ画面（Plugin Shell、Panel、OS領域）を使いたい。当初はElectronのmainプロセスが自らCoreへ接続・登録し、preloadのIPCで `ShellHost` を実装する別のPluginとして作った。その結果、Web PluginのGoサーバーが担う処理（登録とLeaseの更新、Toolの呼び出し、Project以下の保存、PanelのUIファイルの取得）をTypeScriptで複製することになり、2つの実装のずれを文書で抑える必要があった。

## 決定

- Electron Pluginは、`apps/electron/` に置くviewerである。viewerとしてはCoreへ自分で接続せず、Web Plugin（plugumi-web）がloopbackで配る画面を `BrowserWindow` で開くだけとする。登録・保存・UI取得はWeb Pluginに任せるが、Tool提供のためのPlugin接続だけは別途張る（後述）。
- Web Pluginは実行記録（`<cache>/plugumi/plugins/<id>.json`）に待受URLを `url` として書く。Electronのmainプロセスは記録を読み、`GET <url>/api/cores` が200を返すhostを再利用する。見つからなければplugumi-webを子プロセスとして起動する（バイナリは `PLUGUMI_HOST_BIN` で指定する）。再利用したhostは終了時に止めず、自分が起動した子プロセスだけを終了時に止める。
- 画面はPlugin Shell（`shared/workbench`）として共有する。Web Pluginの配るページをそのまま読み込むので、`ShellHost` の実装はHTTP（`/api`）の1本だけになり、preloadのIPC実装や `plugumi-ui://` プロトコルは持たない。
- Areaを別windowに出す（detach）とタイトルバー装飾のテーマ連動だけはpreloadのIPCで行う。preloadは `window.plugumiWindows.open(path)` を公開し、mainプロセスは `plugumi:open-window` で受けたpathをhost URLで開く。テーマはrendererの `plugumi:theme` DOMイベントをpreloadが `plugumi:theme` IPCへ中継し、mainプロセスが `titleBarOverlay` に反映する。
- detachはElectron専用の操作とする。Web側の `ShellHost.windows` はpreloadのbridgeがあるときだけ非nullになり、ブラウザでは別windowへ出す操作を出さない。
- Project以下の保存はWeb Pluginの `~/.plugumi/web/` に一本化する。Electron独自の `~/.plugumi/electron/` は廃止し、Electron Plugin自身のCore接続・保存・UI取得のTypeScript実装は削除する。
- ウィンドウは `BrowserWindow` に `titleBarOverlay` を指定する。ElectronはこのときWindow Controls OverlayのCSS環境変数を提供するので、PWAと同じOS領域のCSSを使える。

## 代替案

| 案 | 採らない理由 |
|---|---|
| ElectronのmainプロセスがPluginとしてCoreへ接続・登録する（当初の実装） | Web Pluginと同じ処理をTypeScriptで複製することになり、接続・保存・UI取得のずれを2実装で管理し続ける必要がある |
| 画面もElectron用に別に作る | 同じ画面を2つ保守することになる |
| ElectronにWeb PluginのGoサーバーを同梱して起動する | 配布物に同梱する仕組みが要る。配布方法が決まるまでは、開発時に `PLUGUMI_HOST_BIN` へビルド済みバイナリを指定する方が軽い |

## トレードオフと帰結

- Coreへの接続、保存、UIファイルの取得はWeb PluginのGo実装1本になる。Electron側のTypeScript backend（約1,100行）は削除した。
- ElectronがCoreへ登録するoperationは、内部ブラウザ（Chromium）を持つこと由来のもの、すなわちwindowの開閉・一覧・フォーカス・描画内容の取得（operation pathは `electron/window/*`）のような、Webのhostには出せない能力に限る。同じ由来のPanel（`apps/electron/ui` のWindows Panel）もUI bundleとして登録する — Electronが繋がっているときだけpickerに現れる。接続先はviewerが開いているhostの `GET /api/cores` に追従し、Coreごとにviewerとは別のPlugin接続を張る。TypeScript側のPlugin接続機構（registration・RPC・実行記録・UI bundleの登録）は `packages/plugin-client` としてagentと共有する。ElectronのmainプロセスはCJSだが、同梱Node（24系）の `require(esm)` でpure ESMの同packageを読む。
- ElectronはWeb Plugin無しには動かない。viewerがhostを起動・発見するため、利用者が意識する必要はないが、Web Pluginが起動できない環境（実行中のhostもplugumi-webバイナリも無い）ではElectronも使えない。
- 保存先を分けないので、Web Pluginで作ったProjectはElectronにもそのまま出る。
- 依存として `electron` の追加を承認済み。ビルドの補助ツールや配布用のパッケージ作成ツールは、必要になったときに改めて決める。
- `BaseWindow` と `WebContentsView` の組み合わせでは、Window Controls OverlayのCSS環境変数が取れないという報告がある。そのため、`BrowserWindow` を使う。

---
type: decision
title: Electron PluginはWeb PluginとPlugin Shellを共有し、サーバーを持たない
description: Electron Pluginを、GoもHTTPサーバーも使わない別のPluginとして作る。画面はPlugin ShellとしてWeb Pluginと共有する。
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

[Decision 00013](00013-web-plugin-gateway.md)で、ブラウザ向けの画面はWeb Pluginが提供し、Web PluginのGoサーバーがブラウザとCoreを仲介すると決めた。[システム構成 00002](../architecture/00002-plugin-client-system.md)は、WebとElectronを独立したPluginとし、Webの配信方法をElectronに強制しないとしている。

Electronでも、Web Pluginと同じ画面（Plugin Shell、Panel、OS領域）を使いたい。

## 決定

- Electron Pluginは、Web Pluginとは別のPluginとして `plugins/electron/` に置く。GoもHTTPサーバーも使わない。
- Electronのmainプロセスが、Pluginとして自らCoreへ接続・登録する。Web PluginのGoサーバーが担う処理（登録とLeaseの更新、Toolの呼び出し、Project以下の保存、PanelのUIファイルの取得）を、mainプロセスがTypeScriptで行う。
- 画面はPlugin Shell（`shared/plugin-shell`）として共有する。Plugin Shellは `ShellHost` というinterfaceを通してだけ外とやりとりする。Web Pluginは `/api` へのHTTPで、ElectronはpreloadのIPCで、それぞれ `ShellHost` を実装する。
- PanelのUIファイルのURLは `ShellHost` が返す。Web Pluginは自身の `/ui/` を、Electronは独自のプロトコル（`plugumi-ui://`）を返し、mainプロセスがCoreから取得して応答する。
- Coreへの接続処理は共有しない。各Pluginが自分の言語で書き、RESTのクライアントはCoreのOpenAPIから生成する。Electron Pluginも、mainプロセスの中に自分で書く。
- リポジトリのルートをpnpm workspaceにする。リポジトリの中だけで共有するものは `shared/` に、外に配布するもの（Plugin Viewの作者向けパッケージ `packages/plugin-view` など）は `packages/` に置く。
- Project以下の保存形式は[Design 00004](../designs/00004-web-plugin-screen-hierarchy.md)と同じにする。保存先は分け、Electronは `~/.plugumi/electron/<Core名>.json` を使う。
- ウィンドウは `BrowserWindow` に `titleBarOverlay` を指定する。ElectronはこのときWindow Controls OverlayのCSS環境変数を提供するので、PWAと同じOS領域のCSSを使える。

## 代替案

| 案 | 採らない理由 |
|---|---|
| ElectronがWeb Pluginのページを開くだけにする | Web Pluginを別に起動しておく必要があり、Electronが独立したPluginにならない |
| ElectronにWeb PluginのGoサーバーを同梱して起動する | GoとHTTPサーバーをElectronに持ち込む。Electronを別のPluginとする方針と合わない |
| 画面もElectron用に別に作る | 同じ画面を2つ保守することになる |

## トレードオフと帰結

- Coreへの接続、保存、UIファイルの取得は、Go（Web Plugin）とTypeScript（Electron）の2つの実装になる。2つの動きがずれないよう、保存形式と `ShellHost` の意味を文書で固定する。
- 保存先を分けるので、Web Pluginで作ったProjectはElectronには出てこない。同じファイルを2つのPluginが後勝ちで上書きし合うことは起きない。
- 依存として `electron` の追加を承認済み。ビルドの補助ツールや配布用のパッケージ作成ツールは、必要になったときに改めて決める。
- `BaseWindow` と `WebContentsView` の組み合わせでは、Window Controls OverlayのCSS環境変数が取れないという報告がある。そのため、`BrowserWindow` を使う。

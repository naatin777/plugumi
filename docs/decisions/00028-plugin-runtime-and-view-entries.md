---
type: decision
title: PluginをPlugin runtimeとPlugin viewに分け、shell拡張は持たない
description: Web / ElectronがPluginだった時代のshell拡張entryを廃止し、Pluginの構成概念をPlugin runtimeとPlugin viewに限定する方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00015'
    - '00021'
---

## コンテキスト

Web / ElectronもPluginだった時代には、利用者がshellをpluginで改造できる構成を想定していた。そのため、Panelの中身を描くUIとは別に、shellのcommand、menu、status、notificationなどを拡張するClient entry / workbench entryという概念があった。

現在の方針では、Web app / Electron appの公式UI Appはinstallable pluginとして差し替えない。shell構造そのものを変えたい場合はforkまたはdownstream hostとして扱う。公式shellに必要な共通実装は `shared/` 側へ置く。

あわせて、Plugin内部の説明に `backend entry` / `runtime entry` / `view entry` / `host` などの語を増やすと、コード、process、UI、接続clientの区別が分かりにくい。基本概念はPlugin runtimeとPlugin viewの2つに絞る。

## 決定

- Pluginの構成概念は **Plugin runtime** と **Plugin view** に限定する
- Plugin runtimeは、Pluginのうち画面ではない側で動く部分とする。operationの提供、状態保持、event処理、agent loopなどを担う
- Plugin viewは、Panel / Embed / Widgetとして画面描画とUI操作を担う部分とする
- Plugin runtimeはProviderとしてCoreへ接続し、接続・登録時にPlugin manifestをPOST / PUTなどでCoreへ送る
- Plugin manifestはファイルではなく、Plugin runtimeがCoreへ送る宣言情報である。operation宣言、UI contribution宣言、UI bundle参照などを含む論理集合として扱う。実際のwire上は複数のREST操作へ分かれてよい
- Plugin viewはProviderとしてCoreへ接続しない。UI App / Workbench shellから受け取る狭いcontext経由で操作する
- CoreへのWS接続、登録、reconnect、operation dispatch、UI bundle登録などの共通処理はPlugin runtimeそのものではなく、Plugin runtimeが使うruntime support libraryの責務として分ける。Panel / Embed / Widgetの型、context、design tokenなどの共通処理はview support libraryの責務として分ける
- shell自体を拡張する `client entry` / `workbench entry` はPluginに持たせない
- shell構造やshell標準機能を変えたい場合は、pluginで配布せず、公式shellでは `shared/` の実装へ反映するか、fork / downstream hostで対応する

## 代替案

**workbench entryを残す。** shellの小さな拡張をpluginへ委譲できるが、公式shellの責務とpluginの責務が再び混ざり、UI Appをfork前提にする現在の方針と矛盾するため採用しない。

**shellの拡張点をすべて禁止する。** Panel / EmbedのようなPlugin viewまで禁止するとPluginがUIを提供できないため採用しない。禁止するのはshell本体を改造する仕組みであり、Panel / Embed / Widget内のUIではない。

**runtime entry / view entryを基本概念にする。** `entry` は最初に読み込むファイルという意味で、processやUIそのものではない。Plugin作者向けの実装詳細としては使えても、基本概念にするとruntime、process、view、接続clientの区別が分かりにくいため採用しない。

## トレードオフと帰結

得るもの: Pluginの責務をoperation側のPlugin runtimeとUI側のPlugin viewに絞れる。shell改造とPanel / Embed / Widgetの提供を区別でき、Web app / Electron appをfork前提にする方針と一致する。`backend` / `entry` / `host` を基本概念へ増やさずに済む。

失うもの: 利用者がinstallable pluginだけでshellのcommandやstatusを自由に拡張する仕組みは持たない。必要なshell標準機能は公式shellへ実装するか、forkで作る必要がある。

Architecture 00003の `Backend entry` / `Client entry` / `View entry` の3分類は、このdecisionに従って修正する。`runtime entry` / `view entry` も基本概念には使わず、Plugin runtime / Plugin viewへ揃える。

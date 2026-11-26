---
type: decision
title: Plugin entryをruntimeとviewに限定し、shell拡張entryは持たない
description: Web / ElectronがPluginだった時代のshell拡張entryを廃止し、Plugin packageのentryをruntime entryとview entryに限定する方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00015'
    - '00021'
---

## コンテキスト

Web / ElectronもPluginだった時代には、利用者がshellをpluginで改造できる構成を想定していた。そのため、Panelの中身を描くView entryとは別に、shellのcommand、menu、status、notificationなどを拡張するClient entry / workbench entryという概念があった。

現在の方針では、Web app / Electron appの公式UI Appはruntime installableなpluginとして差し替えない。shell構造そのものを変えたい場合はforkまたはdownstream hostとして扱う。公式shellに必要な共通実装は `shared/` 側へ置く。

## 決定

- Plugin packageのentryは `runtime entry` と `view entry` に限定する
- shell自体を拡張する `client entry` / `workbench entry` はPlugin packageのentryとして持たない
- shell構造やshell標準機能を変えたい場合は、pluginで配布せず、公式shellでは `shared/` の実装へ反映するか、fork / downstream hostで対応する
- runtime entryはtransport上はCoreへのWebSocket clientとして振る舞うことがあるが、概念名を `wsクライアント` とはしない。operation実装、状態保持、event処理、agent loopなどを担うUI非依存のentryとする
- view entryはPanel / Embed内で画面描画とUI操作を行うentryとする

## 代替案

**workbench entryを残す。** shellの小さな拡張をpluginへ委譲できるが、公式shellの責務とpluginの責務が再び混ざり、Hostをfork前提にする現在の方針と矛盾するため採用しない。

**shellの拡張点をすべて禁止する。** Panel / Embedのようなview entryまで禁止するとPluginがUIを提供できないため採用しない。禁止するのはshell本体を改造するentryであり、Panel / Embed内のUIではない。

## トレードオフと帰結

得るもの: Pluginの責務をoperation側のruntimeとPanel / Embed側のviewに絞れる。shell改造とPanel提供を区別でき、Web app / Electron appをfork前提にする方針と一致する。

失うもの: 利用者がinstallable pluginだけでshellのcommandやstatusを自由に拡張する仕組みは持たない。必要なshell標準機能は公式shellへ実装するか、forkで作る必要がある。

Architecture 00003の `Backend entry` / `Client entry` / `View entry` の3分類は、このdecisionに従って修正する。`Backend entry` は `runtime entry`、`View entry` は `view entry` とし、`Client entry` は廃止する。

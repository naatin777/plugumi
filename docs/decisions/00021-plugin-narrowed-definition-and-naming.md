---
type: decision
title: Pluginを縮小定義で残し、製品名をPlugumiとする
description: everything-is-a-pluginをやめつつ、installable packageとしてのPluginの名称と製品名Plugumiを残す方針を記録する。
status: draft
---

## コンテキスト

modstrataではHost・Environment・連携・UI componentまで全てがPluginであり、寿命・trust level・targetの異なるものが同じ枠に入る扱いづらさがあった。再設計にあたり、Host / Environment / Core builtinをPluginから分ける方向は[Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md)（draft）で検討している。

その際、残ったinstallable packageの呼び名をExtensionへ改める案が出た。しかしExtensionを選ぶ理由として挙げられたもの（複数entryを持てる、manifest / contribution / activationを持つ、UIやshell customizationを含む、everything-is-a-pluginと切り分けられる）は、全て概念の再定義の効果であり、改名の効果ではなかった。IntelliJ・Eclipse・Obsidianのpluginはまさにmanifestと複数contributionを持つパッケージであり、「plugin = 単一のruntime module」という語感は業界標準ではない。

なお、概念そのものを消すことはできない。install単位をなくすとbackend / client / viewを個別に登録することになり、activation前にcontributionを索引できず、install / update / uninstallの単位がばらけ、信頼判断の単位も失われる。manifestを持つinstall単位は構造的に必要である。

## 決定

- Pluginを縮小定義で残す。Pluginは「複数contributionを束ねるinstallable package」であり、利用者が追加する外部拡張パッケージを指す
- Host / Environment / Core builtin capabilityはPluginではない
- 製品名はPlugumiのままとする

この方針は過去のセッションでユーザーが明示的に合意済みである。文書としての承認はこのファイルのレビューで行う。

## 代替案

**Extensionへ改名する。** VS Codeやbrowser系の語感に寄り、modstrataの語感と心理的に断絶できる利点がある。しかしdocsの全面書き換えコストがかかり、概念の修正は命名と無関係に達成できるため、断絶の利便は使う側が意識していれば済む話であって改名コストに見合わないと判断した。

**PluginとExtensionを併記する。** 内部概念とユーザー向け名称を分ける案。glossaryには「利用者向けの名称はPluginでよい」「Extensionという語への統一は必須ではない」という方向がすでにあり、用語を2つ運用する必要はないと判断した。

## トレードオフと帰結

得るもの: docs churnがほぼゼロであること、業界の語感（IntelliJ / Obsidian / Figma系）と整合すること、plug + gumi（組み合わせる）という製品名の語源が生きること。

失うもの: modstrataの「全部Plugin」という語感との距離が名前の上では取れないこと。概念の再定義で対処する。

帰結: Plugin capabilityの対象範囲はこのdecisionでは決めない。capabilityの分類（Core builtin / Host / Environment・service / Extension / Representation）と、AIがprovider実装ではなくcapabilityとtargetを選ぶ原則は、Architecture 00003と今後のdecisionで扱う。glossaryの「Extension」節はこのdecisionに沿って見直す必要がある。

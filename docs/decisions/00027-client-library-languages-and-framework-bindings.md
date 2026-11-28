---
type: decision
title: Client libraryは必要になった言語から提供し、最初はagent向けTypeScriptとする
description: Go・Rust・Node.jsなどへのclient-side library提供を見据えつつ、実装は必要になった言語から行い、最初はagent向けTypeScriptとする方針を記録する。
status: draft
relations:
  decision:
    - '00008'
    - '00024'
    - '00026'
---

## コンテキスト

Coreとの通信はREST / SSE / WebSocket RPCを使う。REST部分はOpenAPIから生成できる可能性があるが、WebSocket RPCにはrequest/response相関、双方向request、notification、streaming、cancel、reconnect、backpressureなどがあり、薄いHTTP client生成だけでは扱いにくい。

`packages/` は汎用library / SDK / protocol補助実装を置く場所とする（[Decision 00026](00026-packages-and-shared-directory-boundary.md)）。そのため、frontend向けのView libraryだけでなく、client-side binaryを実装する言語向けのlibraryも `packages/` の対象になる。

## 決定

- Client-side libraryを複数言語へ提供する方針とする。候補はGo、Rust、Node.js / TypeScript、Kotlin、Swift、C#を含む
- ただし、全言語のlibraryを一度に実装することまでは決めない。libraryは必要になった言語から実装し、最初はagentが使うためTypeScript / Node.js向けを作る。Go・Rust・Kotlin・Swift・C#は必要になった時点で追加する
- 通信protocolはHonoに依存しない。Honoは `apps/web` 側の実装詳細であり、client libraryが従う正本はCoreのREST / SSE / WebSocket RPC contractとする
- REST部分の型やclient生成にOpenAPI Generatorを使うかは検証対象とする。WebSocket RPCの意味論はOpenAPI生成だけではカバーしない
- frontend向けlibraryはいったんTypeScriptのみとする。React・Svelte・Solid向けのhooksやframework bindingは最初から提供しない
- TypeScript / Node.js向けlibraryの新しいpackage名は未決定とする。npm artifact名に `ts` を付ける必要はないが、複数言語の実装を並べるdirectory名や各言語のartifact名は、必要になった時点でその言語のecosystemに合わせて決める
- 現行 `packages/plugin-client` はlegacyなのでrenameだけは行わない。operation / Execution移行で責務を分けた新しいlibraryへ置き換えてから削除する
- frontendのView作者向けpackageは、いったん現行の `@plugumi/plugin-view` を維持する

## 代替案

**TypeScriptだけを公式client libraryにする。** 現行実装に近く短期間では楽だが、Environment ProviderのRust、Core関連のGo、将来のmobile / desktop / service実装を考えると不足するため採用しない。

**全言語へ最初から同等のlibraryを用意する。** 仕様が移行中の段階では保守対象が増え、operation / Execution modelの変更を全言語へ繰り返し反映する必要があるため採用しない。

**OpenAPI生成だけでclient libraryを完成させる。** RESTの単発操作には使える可能性があるが、WebSocket RPC、streaming、cancel、reconnect、bidirectional requestを表現できないため採用しない。

## 命名の扱い

TypeScript / Node.js向けlibraryの命名は確定しない。候補として `core-client`、`provider`、`core-transport` などがあるが、現行 `plugin-client` にはCore接続、Tool dispatch、UI bundle読込、process recordが混在しているため、責務を分ける前に名前だけ決めると実態と合わない。`core-client` は通信clientとしては自然だがprovider登録の役割を表しにくく、`provider` はPlugin runtime向けとしては自然だがcallerや低level通信まで含めると狭すぎる。

責務の境界としては、Core接続、WebSocket RPC、tool / operation dispatch、UI bundle登録を通信library側の候補とする。一方、process record、heartbeat、cache path、host discoveryはCore通信libraryの責務にせず、process lifecycle / discovery側の責務として分ける。この境界を具体化するには、Core、Plugin runtime、Environment Provider、UI Appの起動・停止・所有関係を先に整理する必要がある。

npmのTypeScript / Node.js artifact名に `ts` を付ける必要はない。package自体がJavaScript / TypeScript ecosystemのartifactだからである。一方、Go・Rustなどの実装をrepository内で並べる場合は、directory名やartifact名を各言語のecosystemに合わせて区別する必要がある。ただし、その命名規則も最初の非TypeScript実装が必要になるまで確定しない。

## トレードオフと帰結

得るもの: WebSocketまわりの複雑さを各Provider / client実装へ分散させず、言語ごとのlibraryへ集約できる。framework非依存のcommunication layerと、SolidなどのUI integrationを分けて検討できる。

失うもの: 複数言語のlibrary設計・conformance test・schema生成の費用が増える。公開予定で分類はしないが、libraryとしての品質は必要になる。

現行 `packages/plugin-client` はTypeScript / Node.js向けのlegacyな接続SDKであり、この方針の完成形ではない。operation / Execution modelへの移行では、まずagentが利用するTypeScript / Node.js向けclient libraryとして必要な範囲を作り、他言語は要求が出てから追加する。

frontendでは、公式UI実装がSolidへ統一されること（[Decision 00025](00025-official-ui-framework-solid.md)）と、plugin作者向けのframework bindingを提供することは別の問題である。plugin作者向けlibraryはいったんTypeScriptのみとし、framework固有のhooksやadapterは必要が分かってから検討する。

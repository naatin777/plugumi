---
type: decision
title: agentはbuilt-inではなくpluginとする
description: AI agentをCore / UI Appのbuilt-in機能にせず、operationとviewを提供するpluginとして構成する方針を記録する。配布上のfirst-party同梱とは分ける。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00028'
    - '00031'
    - '00035'
---

## コンテキスト

AI agentをPlugumiのbuilt-in機能にするか、pluginにするかは未定のままだった。renderer差し替えモデルの確立（[Decision 00035](00035-a2ui-as-declarative-surface-payload.md)）により、built-inにする技術的動機がなくなったため決定する。

## 決定

**agentはbuilt-inではなくpluginとする。**

- agentはoperationとviewを提供するpluginとして構成する。Core / UI Appはagentの存在に依存しない
- chat surfaceやagent UIはplugin viewとして実装される
- 複数のagent pluginが共存でき、ユーザーが差し替えられる
- agent runtimeはcallerであると同時にproviderでもあるという既存の整理をそのまま使う。特別扱いする仕組みはCoreに入れない

## 配布とアーキテクチャを分ける

「同梱するかどうか」はアーキテクチャではなく配布の問いとする。first-partyの公式agent pluginをdefaultで同梱し、installなしでagentが使える体験にしてよい。VS Codeのbuilt-in extensionと同じ形であり、アーキテクチャ上はpluginのままである。

## 理由

- agent runtimeはすでに「callerでありproviderである特別扱いしない存在」として設計されており、built-inはこの一貫性を崩す
- renderer差し替えモデルにより、built-inでなくてもUIをApps UIに寄せられる。built-inの技術的動機がない
- 複数agentの共存・競合が可能になり、エコシステムとして正しい形になる
- chat panelやagent UIがplugin viewとして実装されることで、Plugumi自身のplugin基盤のdogfoodingになる
- Coreがleanに保たれる

## 帰結

- 将来native clientを作る場合も、agent pluginはA2UI payloadを出力するだけで、描画はclient側のrendererが担う
- plugin配信のUI（rendererやcomponent）は、webではJS配信、nativeではclient側のnative rendererで上書きされる

## 未解決の問い

- 公式agent pluginの同梱形態。default installか、setup時に選ぶか
- agent pluginの具体的なcontribution構成。chat panel、widget、operation群の内訳

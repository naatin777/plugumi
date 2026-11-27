---
type: decision
title: declarative surfaceのpayload仕様としてA2UIを採用する
description: json-render / OpenUI / Open-JSON-UIと比較した上で、A2UIをsurfaceのpayload仕様に採用する方針とその理由を記録する。
status: draft
relations:
  design:
    - '00008'
    - '00010'
  decision:
    - '00020'
---

## コンテキスト

declarative surfaceのpayload仕様として、以下の候補を調査・比較した。

- **A2UI**（Google）: versioned protocol。wire message、data model分離、JSON Pointer binding、incremental updateを持ち、TypeScript / Python / Dart / Swift / KotlinのSDKとconformance suiteがある。rendererはSwiftUI / Jetpack Compose / Flutter / Web（React / Lit / Angular）がfirst-party
- **json-render**（Vercel Labs）: zod catalog中心のframework。Spec（flat element map）+ state model + JsonPatchで、architectureはA2UIと同型。公式のSolidJS rendererを持ち、採用実績も大きい。ただしTypeScript中心で、cross-languageのversioned spec治理はない
- **OpenUI**（thesys）: OpenUI LangはJSONではなくトークン効率を優先した独自言語。rendererはSolidを持たず、商用会社のエコシステム依存。なおthesys自身が `@openuidev/a2ui` でA2UI v1.0へbridgeしている
- **Open-JSON-UI**（OpenAI）: draftのみでspec本体もSDKも存在せず、候補として成立しない

## 決定

declarative surfaceのpayload仕様として**A2UIを採用する**。

採用するのはpayload定義（wire message形式とcatalog仕様）であり、transportはPlugumi独自のCore WS / Execution streamを使う。AG-UIは採用しない。

## 理由

- **multi-platformの一貫性**。同じversioned specに対してSwiftUI / Jetpack Compose / Flutter / Webのrendererがfirst-partyで存在する。agentがbuilt-inでUIをApps UIに寄せられる場合、将来native clientを作ったときに同じsurfaceがそのままネイティブ描画できる。json-renderにもSwift / React Nativeはあるが、versioned specによる横断の一貫性はA2UIが強い
- **spec治理**。versioned spec、JSON Schema、conformance suite、evolution guideがあり、agentがpluginエコシステムになる場合にplugin作者の多言語での生成を支えられる
- **generation edgeとwire formatの分離**。A2UIはinference format（モデルが出力しやすいcompact形式）をcompileしてwire messageにする分離を公式に持つ。OpenUI Langのようなトークン効率最適化はgeneration edgeの話であり、wire formatの選択と競合しない
- breaking changeの履歴はあるが、これは採用側全員が同じ条件であり、version pinningとevolution guideで対処できる通常コストと判断する

## 帰結

- rendererの提供はlayeredにする。Apps UI（host）が描画基盤を提供し、pluginがUIを提供することもでき、representationのfallback chainで選ぶ（[Design 00008](../designs/00008-embed-references-semantic-projections.md)の解決モデルに従う）。rendererの解決はhost優先とし、plugin配信はfallbackまたはenhanced側に回る
- rendererはプラットフォームごとに差し替え可能であり、specこそが契約になる。webではpluginがJS配信したrendererを使ってもよく、将来native clientを作る場合はkotlin / swiftのnative rendererで上書きできる。同じpayloadがネイティブ描画されることがA2UI採用の利点と整合する
- **SolidJS専用のrendererは作らない**。`@a2ui/lit` はweb component実装でありframework非依存なので、SolidJSのhost内にそのままmountできる。web向けのrendererはweb componentベースとし、hostが内蔵してもpluginが配信してもよい。agentがbuilt-inでもpluginでもこの結論は変わらない
- Plugumi側には薄い抽象層を挟み、A2UIを実装詳細として隠す。将来の交換可能性を残す
- `@a2ui/web_core` のmessage処理、surface管理、data binding、schema検証はライブラリに任せる
- plugin配信のrendererに依存するsurfaceは、そのpluginがいない環境では描画できない。これはunavailable panel / virtual embedの既存の扱いに従う
- OpenUI Lang等のトークン効率のよいgeneration edge形式は、必要になったときagent側のcompile段で導入できる。wire formatの決定を変更しない

## spike検証結果（v1.0、`@a2ui/web_core` 0.16.1 / `@a2ui/lit` 0.16.0）

最小構成のSolidJSアプリで実証済み。

- **描画**: 手書きのv1.0 message（createSurface / updateComponents / updateDataModel）で、SolidJS host内の `<a2ui-surface>` web componentに正しく描画される。Solid側のworkaroundは不要
- **incremental update**: updateDataModelでpath+valueだけ送れば構造を送り直さずにreactiveに更新される。presentation→data modelの流れの中核は検証済み
- **custom component**: zod schemaでAPIを定義し、`A2uiLitElement` 継承のLit実装と `Catalog` に登録してMessageProcessorへ渡す方式で動く。data bindingとstream更新の両方がcustom componentにも届く。tree内では `@catalogId` で参照する
- **action event**: button押下で `{name, surfaceId, sourceComponentId, timestamp, context}` の構造化eventが `surface.onAction` 購読で取れる。operation呼び出しへの接続点は検証済み
- **snapshot / restore**: 公式のserialize APIは見つかっていないが、dataModelは`signals` / `subscriptions`を除けばplain JSONとして抽出でき、component treeはcomponentsModelのMapをwalkして再構成できる。新規processorへのrestoreはcreateSurfaceのinline components + dataModelで実証済み。あるいは入力messageがplain JSONなので、message logを保持してreplayする方式も取れる
- basic catalogのcomponentは `@a2ui/web_core` 内のframework-agnosticなuniversal custom elementとして実装されており、light DOMに描画される。themingはCSS変数（`--a2ui-color-primary` 等）でhost側から制御できる
- 内部reactivityは `@preact/signals-core` ベース。npm package version（0.16.x）とprotocol version（1.0）は別物なので、pinningはpackage versionで行う

## 未解決の問い

- web component rendererの具体的な構成。`@a2ui/lit` をそのまま使うか、catalog拡張のために薄くwrapするか。spikeで基本動作は検証済みだが、Plugumiのcatalog設計と一緒に決める
- surfaceのmessageをPlugumiのtransportにどう乗せるか。Execution streamに混ぜるか、surface専用streamか。[Design 00008](../designs/00008-embed-references-semantic-projections.md)のsnapshot / 再同期との整合
- catalogの定義方法。A2UI basic catalogをそのまま使い、Plugumi custom componentを追加登録する方向だが、登録形式の詳細は未定
- Interaction / Affordanceの詳細。A2UIのaction modelに沿って薄く定義する方向だが、spike後に詰める

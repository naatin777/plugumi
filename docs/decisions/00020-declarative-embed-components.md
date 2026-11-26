---
type: decision
title: EmbedをA2UI-likeなdeclarative surfaceとcustom componentで構成する
description: A2UI-likeなcomponent treeをEmbedのportable baselineにし、tool / artifactに紐づくrich UIをcustom componentとして統合する方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  requirement:
    - '00004'
---

## コンテキスト

現在のPanel moduleは、PluginがJS bundleを登録し、`mount(host, context)` をexportする方向である。この方式はrich UIを作れるが、Agentが一時的な確認UIや結果カードをその場で作るには重い。UIのたびにJS bundleを作り、登録し、Hostへ配信する必要がある。

一方、A2UIはagentまたはbackendがJSON messageでcomponent treeとdata modelを更新し、rendererがそれを描画する方向を提供する。A2UIにはcatalogがあり、basic componentだけでなくcustom componentを登録できる。したがって、A2UIと専用componentは対立しない。専用componentはA2UI-likeなcompositionの中のcustom componentとして扱える。

ただし、diff viewer、terminal、editor、browser viewportのような複雑なUIを、basic componentだけで表現するのは現実的ではない。

## 決定

- Embedの共通表現として、A2UI-inspiredまたはA2UI-compatibleなdeclarative component treeを第一級にする。
- composition layerとimplementation layerを分ける。component tree、data binding、actionの構成はdeclarativeに扱い、個々のcomponentの内部実装はbasic component、standard component、plugin custom componentに任せる。
- rich UIはA2UIの外に出さず、catalog登録されたcustom componentとしてcompositionへ組み込む。例えば `DiffViewer` はJSで実装してよいが、component treeからは `DiffViewer(resource=...)` のように参照する。
- JSを文字列として送ってevalする方式にしない。custom componentの実装は、versionedなasset、module、component registrationとして扱う。
- Embedのoriginは分けるが、基盤は統一する。originの例は、Agentやbackendがその場で作るGenerated UI、tool resultやartifactに紐づくArtifact UI、ExecutionやinteractionなどのPlatform standard UIである。
- tool / artifactとcomponentの紐付けは、重要なartifact familyに限定する。例はdiff、file preview、terminal、execution status、browser viewport、test resultである。全toolに専用componentを作らない。
- component紐付けの基本はtool pathへの直接固定ではなく、tool resultのartifact / resource typeへの紐付けとする。tool側は必要に応じてpreferred representation hintを足す。
- AIは通常、representationを選ばない。AIはtoolを呼び、resource / artifact / affordanceを受け取る。Hostがresource + intent +利用可能なimplementationからrepresentationを選ぶ。
- actionは3種類に分ける。意味のある操作はoperation / tool呼び出しとし、expand / scroll / focusなどはlocal UI action、`この方針で進めて` のような曖昧な指示はintent eventとする。
- A2UIそのものをPlugumi全体のView Protocolへ無条件に適用するのではなく、Plugumi向けのprofileまたはcompatibleなsubsetとして扱う。surfaceの所有、snapshot / resync、operation routingはPlugumi側で定める。

## 代替案

| 案 | 採らない理由 |
|---|---|
| すべてのEmbedをJS moduleにする | Agentがその場で小さな確認UIや結果カードを作りにくい。登録・配布・version管理が重い |
| すべてのEmbedをA2UI basic componentだけで表現する | diff、terminal、editor、browser viewportのような複雑なUIを実用的に作れない |
| A2UI系UIとtool-bound UIを完全に別基盤にする | virtual embed、fallback、action、Host間共有、権限、状態復元を二重に設計することになる |
| tool pathとcomponentを1:1で固定する | 同じartifact typeを複数toolが返す場合に重複する。Hostや表示面積に応じた解決が難しい |
| AIに常時全component catalogを見せる | promptとschemaが大きくなり、component選択ミスが増える |

## トレードオフと帰結

- A2UI-likeな表現は、AgentがUIを生成しやすく、validationとfallbackを設計しやすい。一方で、renderer、catalog、data binding、validationの実装が必要になる。
- custom componentをcatalogへ入れると統一しやすいが、component implementationのversion互換とHost別実装を管理する必要がある。
- tool / artifactとcomponentの紐付けはUXを高めるが、全toolに広げるとcomponent数が増える。標準artifact typeと少数の高価値componentに絞る必要がある。
- 表現はHostが選ぶため、同じresourceでもHostごとに見た目が変わり得る。意味操作を共通化しないと、fallbackでできることが変わる。
- 再検討のきっかけ: A2UIのcatalog / function / transport modelがPlugumiのresource modelと大きくずれ、compatible subsetを保つコストが独自schemaより高いと分かったとき。

## 未解決の問い

- A2UI v1.0へどこまでwire compatibleにするか。独自profileにする範囲。
- 標準catalogに入れるbasic componentとdomain componentの一覧。
- custom componentのprops schema、version、fallback宣言の形式。
- tool resultがartifact typeとpresentation hintをどう返すか。
- AIへ渡すcatalog subsetやmacro / templateの生成方法。

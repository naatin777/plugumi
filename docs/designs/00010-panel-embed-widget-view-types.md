---
type: design
title: Panel / Embed / Widgetのview typeとlifecycle
description: Panel / Embed / Widgetをライフサイクルと役割で区別し、A2UIのsurfaceとの関係、配置先ごとのcontext・制約・生え方の違いを定める検討案。
status: draft
relations:
  requirement:
    - '00004'
  architecture:
    - '00003'
  design:
    - '00006'
    - '00008'
    - '00009'
  decision:
    - '00030'
    - '00034'
---

## 背景

従来のIndicatorは「状態表示を担う独立したPlugin view」とだけ定義されていた。また、EmbedやPanelは参照とrepresentationの仕組みが先行して設計されたが、3つのview typeの本質的な違いが何かは整理されていなかった。

議論の結果、3つの違いはライフサイクルと時間の性質にあることが分かった。またA2UIとの対応を整理した結果、view typeとdeclarativeな表現形式は直交する概念であることが明確になった。

## 3つのview type

| view type | 時間の性質 | 役割 | 例 |
|---|---|---|---|
| Panel | 作業の主体 | 人間が作業する主面。tab / 分割の対象 | file explorer、file viewer、terminal、browser |
| Embed | 記録。resultが来たら基本的に固定 | tool呼び出しの結果や出力を表示する固定の単位 | diff結果、shell出力 |
| Widget | 現在。常時見せるライブな表示 | 状態の常時表示やshortcut | CPU / memory使用量、AI使用量、実行中件数、panel shortcut |

旧IndicatorはWidgetへ改名する。スマートフォンのhome widgetに近いサイズ感と振る舞いを想定する。

**Panel / Embed / WidgetはすべてJSで実装された完成品componentである。** 実装の仕方は同じで、違いはライフサイクルと置き場所だけである。view typeは「どう作るか」ではなく「どう生きてどこに置かれるか」の分類である。

## view typeとsurfaceは直交する

A2UIのdeclarativeなcomponent treeを組み立てたものはEmbedとは呼ばない。A2UIではその単位を**surface**と呼び、Plugumiでもこの語を使う。

```text
surface  … A2UI形式のdeclarativeな内容物1単位。
           component tree + data modelで構成される。
           agentが説明用に構成するものなど、surface内に流れてくる内容物。
           view typeではなく、表現形式の単位である
```

つまり：

- Panel / Embed / Widget … view type。JS実装のcomponent。登録され、一覧でき、ライフサイクルを持つ
- surface … 表現形式。A2UIのcomponent treeとdata model。chat timelineなどの中に現れる内容物

両者は直交する。surfaceの中にembed componentを配置できるし、panelは自身の中にsurfaceをホストできる。

## catalog

catalogは「使えるcomponent部品の一覧とその仕様」であり、許可リストとして機能する。

- A2UIのbasic catalog（Text、Column、Button、Card等）はそのまま使う
- Plugumi custom component（DiffViewer、TerminalView、TestResultViewer等）をcatalogへ追加登録できる
- agentはcatalogに載っているcomponentしか使えない。rendererはcatalogを見てcomponent typeから実装を解決する

Embed / Widget / PanelのcomponentはJS実装であり、これらをcatalogへ登録すればdeclarativeなsurface内からも参照できる。

## 表示の判断はpluginが行う

Coreは表示を強制しない。表示するかどうか、何を出すかはplugin（agent pluginなど）が決める。表示の発生には次の系統がある。

| 生え方 | 説明 |
|---|---|
| 参照解決（受動） | resource + intentからview解決されて表示される |
| tool紐付け（自動） | tool呼び出しに紐づいてembedが自動で表示される。file編集toolにdiff embedが紐づくなど。AIが表示をわざわざ指示しない |
| agent動的構成（能動） | agentがA2UIのsurfaceを構成して表示する。説明用の図など。toolに紐付かない |
| plugin push（widget） | widgetはpluginが供給し、自己更新する |

すべてのtoolがembed componentを持っているわけではない。embed componentが紐付いていないtool呼び出しは、汎用のfallback表示（結果データのtext / JSON表示など）でよい。

通知は特別な機構にしない。通知用のoperationをpanel / embed / widgetから呼べばよく、通知センターはその結果を表示する普通のUIである。

## 操作はoperationへつながる

画面に出る操作手段はoperation呼び出しに紐付けられる。ボタンはpanel内、embed内、surface内、host UIのものを問わずtoolへ紐付けでき、押下はoperation呼び出しになる。A2UIのaction eventがoperation呼び出しに対応する既存の整理の延長であり、操作の入口はview typeによらずoperationへ統一される。

## 開き方と登録

Panel / Embed / Widgetは情報をCoreへ登録し、UI Appが一覧を取得できる。ユーザーはmenu等から選んで開ける。

Panelには2種類ある。

- menu開きできるPanel: file explorerなど。開くのに必要な引数がないか、Coreがcontextを教えられるもの。+ボタンのmenu登録をする
- context必須のPanel: file viewerなど。対象のresource refが必要で、explorer経由などcontextを渡せる経路からしか開けない

Panel contributionはmenuに出すか、開くのに必要な引数を宣言する。

## 配置

- Panel: workspace layoutの一部。tab / 分割の対象
- Embed: 固定の結果表示単位として、流れ（chat timelineなど）に置かれる。panelの中に限定されず、単体のオブジェクトとして存在する
- Widget: どこにでも埋め込める。status barへの固定配置、widget panel内への自由配置に加え、panel内などへの配置も許す方向。widget panelはwidgetを自由に並べられるpanelである

## サイズと密度

Embedのrepresentationはサイズバリアントに応答する。サイズ数は固定せず、ユーザーの密度設定（AI agentの動きを詳しく見たい / 最小限にしたい等）に従う。詳細な表示設定はユーザー側の選択であり、embed作者が強制しない。

## ライフサイクル

- Embed: resultが来たら基本的に固定される。shellの出力表示など、何が起きたかの記録として残る
- Widget: 常時表示され、購読や定期更新で自己更新する。panel shortcutのような静的なものも、CPU / AI使用量のような動的なものも同じ枠組み
- Panel: 作業の主体であり、workspaceとともに保存・復元される。実行は所有しない

## A2UIの採用

declarative surfaceのpayload仕様としてA2UIを採用する。候補比較と理由は[Decision 00035](../decisions/00035-a2ui-as-declarative-surface-payload.md)を参照。

採用するのはA2UIのpayload定義（message形式とcatalog仕様）であり、transportはPlugumi独自のCore WS / Execution streamを使う。AG-UIは採用しない。

- `@a2ui/web_core` を再利用し、MessageProcessor、surface管理、data binding、schema検証はライブラリに任せる
- rendererはweb componentベース（`@a2ui/lit`）とし、SolidJS専用のrendererは作らない。web componentはframework非依存なのでSolidJSのhost内にそのままmountできる。renderer自体はhost内蔵またはplugin配信のどちらでもよく、fallback chainで解決する
- A2UIは若い仕様でbreaking changeの履歴があるため、version pinningを必須とする
- rendererはlayeredにする。Apps UI（host）が描画基盤を提供し、pluginがUIを提供することもでき、representationのfallback chainで選ぶ
- Generative UIの3分類はPlugumiの表現モデルの段として同居する。custom componentはControlled、surfaceはDeclarative、plugin view（フルJS module）はOpen-endedに対応する

## outputの分離

toolのoutputは、AIに渡す用（result）とembedに渡す用（presentation）を別フィールドで分ける。

- result … AIへの判断材料。compactな構造化データ
- presentation … embedやsurfaceへ表示するためのデータ。embed componentのdata modelへ流し込まれる。A2UIのupdateDataModel相当として扱う方向

component構造は宣言側が持ち、実行結果のpresentationデータがdata modelへ流し込まれる。A2UIの「UI構造とデータを分離する」モデルと一致する。resultとpresentationは届くタイミングが違ってよく、実行中はpresentationがstreamで随時流し込まれ、完了時にresultが返る形を自然なものとする。

## 既存designとの関係

- [Design 00006](00006-panel-references-virtual-panels.md)のPanel Reference / virtual panelの仕組みはこの枠組みの中で維持する
- [Design 00008](00008-embed-references-semantic-projections.md)のEmbed Reference / representation解決 / Interaction / Affordanceは維持する。ただし「embedはchat / timelineに埋まる」という前提は弱め、embedは固定の結果表示単位として単体でも存在できるものとする
- [Design 00009](00009-execution-ui-placements.md)のExecution Viewの複数placementへの投影は維持する。placementはこのdesignのview typeと配置の整理に従う

## 追加の方向

- tool紐付けの自動表示は、operation宣言にembedを入れる方向。operation宣言にはinputSchema等があり、その中にembed紐付けも含める
- widget panelの配置情報はArea / Workspaceなどの画面階層の一部として扱う方向。widgetは場合によってpanelとしても使える
- panel表示時の引数はpanelContextとして渡す方向。詳細な形式は未決定だが、呼び出し時の引数が基本となる
- widgetの自己更新は、widget内のtimer（setInterval相当）またはWS購読で行う方向。特別な仕組みは設けない
- menu登録の宣言はCoreへ渡す方向。UI AppがCoreからmenu一覧を取得できるようにする

## 未解決の問い

- operation宣言内のembed紐付けの具体的な形式。outputのどの部分をembedに渡すかの対応づけ
- resultとpresentationのフィールド名とschema。presentationをdata modelへどうマッピングするか
- panelContextの具体的な形式
- widgetの自己更新間隔や、表示されていないときの更新抑制
- menu登録の宣言形式の詳細。表示名、icon、順序
- 汎用fallback表示の具体的な形式

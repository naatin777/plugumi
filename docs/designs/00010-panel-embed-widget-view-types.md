---
type: design
title: Panel / Embed / Widgetのview typeとlifecycle
description: Panel / Embed / Widgetをライフサイクルと役割で区別し、描画技術とview解決を統一しつつ、配置先ごとのcontext・制約・生え方の違いを定める検討案。
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

議論の結果、3つの違いはライフサイクルと時間の性質にあることが分かった。

## 3つのview type

| view type | 時間の性質 | 役割 | 例 |
|---|---|---|---|
| Panel | 作業の主体 | 人間が作業する主面。tab / 分割の対象 | file explorer、file viewer、terminal、browser |
| Embed | 記録。resultが来たら基本的に固定 | tool呼び出しの結果や出力を表示する固定の単位 | diff結果、shell出力、説明用の図 |
| Widget | 現在。常時見せるライブな表示 | 状態の常時表示やshortcut | CPU / memory使用量、AI使用量、実行中件数、panel shortcut |

旧IndicatorはWidgetへ改名する。スマートフォンのhome widgetに近いサイズ感と振る舞いを想定する。

## 描画技術と解決は統一する

view typeによる描画技術の違いはない。

- declarative component treeを全representationのbaselineとする。A2UIはagent専用の技術ではなく、このbaseline形式を動的に生成することを指す
- custom componentはenhanced representationとする
- view解決はresource + intentからrepresentationを選ぶ機構で統一する。representationは配置先の制約とサイズに応答する

配置先ごとにcontext、サイズ制約、interaction可否、寿命、引き取る値は違う。「同じviewをどこにでも置ける」のではなく、同じ解決機構を通りつつ、配置先に応答してrepresentationが描画を変える。

## 表示の判断はpluginが行う

Coreは表示を強制しない。embedを出すかどうか、何を出すかはplugin（agent pluginなど）が決める。表示の発生には次の系統がある。

| 生え方 | 説明 |
|---|---|
| 参照解決（受動） | resource + intentからview解決されて表示される |
| tool紐付け（自動） | tool呼び出しに紐づいてembedが自動で表示される。file編集toolにdiff embedが紐づくなど。AIが表示をわざわざ指示しない |
| 自由なA2UI（能動） | toolに紐付けず、agentがcomponent treeを構成して表示する。説明用embedなど |
| plugin push（widget） | widgetは参照解決で生えるのではなく、pluginが供給するmicro surface。自己更新する |

通知は特別な機構にしない。通知用のoperationをpanel / embed / widgetから呼べばよく、通知センターはその結果を表示する普通のUIである。

## 開き方と登録

Panel / Embed / Widgetは情報をCoreへ登録し、UI Appが一覧を取得できる。ユーザーはmenu等から選んで開ける。

Panelには2種類ある。

- menu開きできるPanel: file explorerなど。開くのに必要な引数がないか、Coreがcontextを教えられるもの。+ボタンのmenu登録をする
- context必須のPanel: file viewerなど。対象のresource refが必要で、explorer経由などcontextを渡せる経路からしか開けない

Panel contributionはmenuに出すか、開くのに必要な引数を宣言する。

## 配置

- Panel: workspace layoutの一部。tab / 分割の対象
- Embed: 固定の結果表示単位として、流れ（chat timelineなど）に置かれる。panelの中に限定されず、単体のオブジェクトとして存在する
- Widget: status barへの固定配置と、widget panel内への自由配置の両方を許す。widget panelはwidgetを自由に並べられるpanelである

## サイズと密度

Embedのrepresentationはサイズバリアントに応答する。サイズ数は固定せず、ユーザーの密度設定（AI agentの動きを詳しく見たい / 最小限にしたい等）に従う。詳細な表示設定はユーザー側の選択であり、embed作者が強制しない。

## ライフサイクル

- Embed: resultが来たら基本的に固定される。 shellの出力表示など、何が起きたかの記録として残る
- Widget: 常時表示され、購読や定期更新で自己更新する。panel shortcutのような静的なものも、CPU / AI使用量のような動的なものも同じ枠組み
- Panel: 作業の主体であり、workspaceとともに保存・復元される。実行は所有しない

## 既存designとの関係

- [Design 00006](00006-panel-references-virtual-panels.md)のPanel Reference / virtual panelの仕組みはこの枠組みの中で維持する
- [Design 00008](00008-embed-references-semantic-projections.md)のEmbed Reference / representation解決 / Interaction / Affordanceは維持する。ただし「embedはchat / timelineに埋まる」という前提は弱め、embedは固定の結果表示単位として単体でも存在できるものとする
- [Design 00009](00009-execution-ui-placements.md)のExecution Viewの複数placementへの投影は維持する。placementはこのdesignのview typeと配置の整理に従う

## 追加の方向

- tool紐付けの自動表示は、operation宣言にembedを入れる方向。operation宣言にはinputSchema等があり、その中にembed紐付けも含める。toolのoutputは、AIに渡す用とembedに渡す用を分ける
- widget panelの配置情報はArea / Workspaceなどの画面階層の一部として扱う方向。widgetは場合によってpanelとしても使える
- panel表示時の引数はpanelContextとして渡す方向。詳細な形式は未決定だが、呼び出し時の引数が基本となる
- widgetの自己更新は、widget内のtimer（setInterval相当）またはWS購読で行う方向。特別な仕組みは設けない
- menu登録の宣言はCoreへ渡す方向。UI AppがCoreからmenu一覧を取得できるようにする

## 未解決の問い

- operation宣言内のembed紐付けの具体的な形式。outputのどの部分をembedに渡すかの対応づけ
- tool outputの「AI向け」と「embed向け」の分け方の形式。同一データの2つの投影か、別フィールドか
- panelContextの具体的な形式
- widgetの自己更新間隔や、表示されていないときの更新抑制
- menu登録の宣言形式の詳細。表示名、icon、順序

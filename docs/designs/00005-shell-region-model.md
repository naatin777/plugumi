---
type: design
title: Shellの領域モデルとパネル配置
description: Web/Electron Shellの領域分割、パネルのスコープ、表示モード、activity表示契約を定める。
status: draft
relations:
  requirement:
    - '00003'
    - '00004'
  design:
    - '00004'
  contract:
    - '00005'
---

## 対応するrequirement

[Requirement 00004](../requirements/00004-common-protocol-contracts.md)は人間がPluginの機能を画面から利用することを求めている。本書は[Design 00004](00004-web-plugin-screen-hierarchy.md)の階層（Core > Project > Area > Workspace）の下で、Shellがパネルをどの領域にどう配置するかを定める。

## 画面の構成

```
┌─────────────┬──────────────────┬────────┬────────┐
│   sidebar   │                  │        │        │
│ Projects    │    workspace     │ right  │ pinned │
│ Areas       │                  │        │        │
│ ────────── │                  │        │        │
│   left      ├──────────────────┤        │        │
│             │     bottom       │        │        │
└─────────────┴──────────────────┴────────┴────────┘
   （topbarは上、statusbarは下の横帯。図の4列が縦領域）
```

| 領域 | 役割 | スコープ |
|---|---|---|
| sidebar | Shellのナビ中枢。Space=Project、Tab=Area。Projects切替とArea一覧を持つ常設領域 | shell固有（Panelではない） |
| left / right / bottom | Area-scopeの縁領域。位置が契約（left=一覧系、bottom=terminal系の横広、right=補助）。開閉できる | Area |
| workspace | 作業面。splitの木で区画に分けてパネルを配置する | Area |
| pinned | Project-scopeの縦領域。Areaをまたいで常時見えるwidgetの掲示板（外部サービスの状態・モニター等） | Project |

## 領域のモデル

### 位置が契約

left・right・bottom・pinnedは機能の区切りではなく**位置の契約**である。

- 位置は形状を決める（縦帯=高く狭い、bottom=横に広く低い）
- 位置は規約を運ぶ（filesは左、terminalは下 — クロスアプリで学習済み）
- 位置はtoggleの同一性を持つ（⌘1・⌘2等の固定キーに紐づく）
- 位置は永続化のアドレスになる（bottomにあったものはbottomに帰る）

領域に固有なのは位置だけで、中身のPanel・表示モード・開閉は全部自由である。

### スコープは2段

Panelの置き場所がそのままスコープになる。「pin」という概念やpanelの状態フラグは存在しない。

- **Project-scope**: pinned。Areaを切り替えても入れ替わらない。Project単位で保存（`getPinned`/`putPinned`）
- **Area-scope**: sidebar以外の全領域。Areaのレイアウトと一緒に保存され、切替で入れ替わる（`getWorkspace`/`putWorkspace`）

スコープはPanelの中身が持つ性質（worktreeのFilesはarea-scopeでしか意味を持たない）であり、領域はその公開先でしかない。

### 表示モード

表示方式は、workspace側の全領域で共通のpagesと、pinned専用のwidget列の2つである。centerはsplitの木で区画に分け、並べて見たいPanelはsplitで並べる。

- **pages**（left・right・bottom・centerのleaf）: tab帯に全Panelのtabを並べ、中身は1つのPanelだけを見せる。Panelは画面外にも本来の大きさのまま横に並んでおり、切り替えると横にスライドする。見えていないPanelは大きさを保ったまま描画だけを止める（`content-visibility: hidden`）。
- **切り替え**: tabの選択、tab帯の上での横スワイプ（1回で1つ隣へ）、前後のキー、マウスの戻る・進むボタンで行う。
- **自由な横scrollはしない**: 中身（Panelの上）での横スワイプ・横scrollはPanelのものとし、外側へ伝えない（`overscroll-behavior-x: contain`）。中身の横scrollでpageが変わる、斜めの縦scrollでpageが動く、ブラウザの「戻る」が発動する、を避けるためである。
- **widget列**（pinned）: 置かれたwidgetを全員縦に積んで同時に見せる。監視・状態確認は「全部ぱっと見たい」が本質で、tabで裏に隠れるpagesとは相性が悪いため、pinnedだけ別の表示方式を持つ。widgetはPanelとは別物で、相互変換（領域をまたぐdragでの移動）はない。widgetの追加は列末尾の「＋」からpickerで選んで新規に作り、並べ替えはpinned列の中だけで行う。

選択中（active）のPanelは各dock・leafの`selected`だけで決まる（pinnedには選択の概念がない）。

### pinned: widgetとindicator

pinnedに置くものは全部同じwidget — headerを持たず中身だけの区画が縦に積まれる。

- **畳むとindicatorになる**: 畳んだwidgetは1行（chevron＋タイトル＋閉じる）だけになり、activityのtone表示がそのままstatus表示として働く。行のclickで展開する。「indicator級の小さいもの」と「モニター級の大きいもの」は別の契約ではなく、同じwidgetの2状態である。
- **開いたwidgetの操作はhoverで浮かせる**: 常設のheaderは持たず、畳み・閉じる・dragの掴み場（grip）はhoverした時だけ中身の右上に出る。
- **高さはwidgetごと**: 中身の高さはwidget同士の境目のdragで変えられる（既定値あり）。畳み状態と高さはPinnedの保存内容に含まれる。
- 溢れたらpinned列の中でscrollする。Panelの中身のscrollはPanelのもの（pagesと同じ）。

## 面と縁

Shellは「土台の上にタイルを並べる」だけで描く。領域同士の区切りは線ではなく、タイル同士の間に覗く土台色の溝（gap）である。

1. **土台（primary）**: ページ全体と、sidebar・pinned・topbar両端・statusbarのframe領域、そしてmatの内側全面に敷く床（work-bed）。カード間のgapは全部この床が覗くので、溝は領域をまたいで連続して貫く。
2. **widgetの面（widget色）**: pinnedの開いたwidget区画。床とタイルの中間で、「床より一段浮いた掲示板の帯」という階層。Panelの面（secondary）とは色でも区別する。
3. **タイル（secondary）**: dock（left・right・bottom）・leaf（centerの区画）の各カードと、topbar中央の浮きバー（segment）。全て同じ色・同じ角丸で、borderは持たない。
4. **操作系（tertiary）**: 入力欄、popover・メニュー、hover、選択中のtab、実行中の強調。タイルの内側にだけ使う。

| token | 使う場所 | Dark | Light |
|---|---|---|---|
| `--plugumi-colors-background-primary` | 土台・frame・床（溝） | #121212 | #FFFFFF |
| `--plugumi-colors-background-widget` | widget区画の帯（開いたwidgetの面） | #181818 | #F8F8F8 |
| `--plugumi-colors-background-secondary` | タイル（dock・leaf・segmentバー）、Panelの面 | #1E1E1E | #F1F1F1 |
| `--plugumi-colors-background-tertiary` | 入力欄・popover・hover・選択中のtab | #2D2D2D | #E5E5E5 |

- **区切りは溝が担う**: カードはborderを引かない。隣り合うカードの間は溝1つだけで、「border｜溝｜border」の二重区切りにしない。溝の幅は`--work-gap`（4px）で、カードの四方は必ず溝に面する。
- **例外: widget区画の枠線**: 開いたwidgetの帯だけはinsetの1px枠（`--plugumi-colors-border`）を持つ。カード同士の区切りには線を使わない方針だが、widgetは背景が床に近く区画の輪郭が読めないため、帯の境界だけ線で示す。畳んだ行（indicator）は枠を持たない。
- **tab帯はカードのheader**: dock・leafは「tab帯（header）＋中身」の1枚のカード。tab帯と中身の間はhairline（divider面）で区切る。
- Panelの面は領域によらずsecondaryで統一し、Shellが敷く。Panelの最背面は透明にして、Shellが敷いた面の色をそのまま使う。widgetはPanelではなく別のmount（WidgetMount）なので、widgetの面はsecondaryではなくwidget色になる。

### タイルの輪郭

- **浮きバー**: topbarでは中央のwork区間（segment）だけが浮きバーになる。左右のtool群（sidebar・pinnedの開閉などframeの操作）はframeに直置きし、バーには含めない。バーは四辺ともgapで離す。
- **splitはsegment方式**: centerをsplitすると、分割したleaf同士は溝で離れるが、regionの外縁の角だけが丸い。splitの内側の辺は直角にして溝を真っ直ぐに通し、外からは1枚のカードの輪郭に見える（Googleのlist viewのsegment方式）。leafの各辺が外縁かどうかはsplit木で伝播する（`Edges`）。
- dockカードは領域全体で1枚なので全角丸い。pinned列はframe領域なのでタイルを持たず、widgetは列の中の「帯」として並ぶ（角丸・溝を持たない区画）。

## 保存の形

Workspace（Areaごと）とPinned（Projectごと）の保存内容は、Shellが所有するJSONである。Web PluginのサーバーとElectron Pluginは中身を解釈せずに保存し、そのまま返す。Shellは読み込み時に形を検査し、形が合わない内容は空のWorkspace・Pinnedとして扱う（移行はしない）。

```ts
type PanelRef = { instanceId: string; pluginId: string; panelId: string };

// left・right・bottom: tab切替の1列
type Stack = { panels: PanelRef[]; selected: string | null };

// center: splitの木
type Leaf = { kind: "leaf"; id: string; panels: PanelRef[]; selected: string | null };
type Split = { kind: "split"; id: string; axis: "x" | "y"; ratio: number; first: Node; second: Node };
type Node = Leaf | Split;

type WorkspaceState = {
  version: 1;
  left: Stack; right: Stack; bottom: Stack;
  center: { root: Node; focusedLeaf: string };
};

// pinned: Projectに1つ。widgetの順序つきリスト（選択はない）
type PinnedWidget = { panel: PanelRef; collapsed: boolean; height: number | null };
type PinnedState = { version: 1; widgets: PinnedWidget[] };
```

- 1つのPanel Instanceは、Workspace・Pinnedのどこか1箇所にだけ置かれる。
- Panel（workspace側のtab）とwidget（pinnedの区画）は別物で、相互変換はない。既存Instanceがpinned⇔workspaceをまたぐ移動は操作自体を捨てる。widgetの追加はpinned列の「＋」からpickerで新規に作る。
- centerのPanelは木のleafにだけ置く。木とは別のPanel一覧は持たない。
- leafが空になったら、そのsplitを畳んで兄弟を昇格させる。最後の1枚のleafは空でも残す。
- 開閉・幅・テーマなど端末ごとの表示設定は、Workspaceには入れずブラウザのlocalStorageに保存する。

## Activity表示

Pluginは`context.setActivity`で**意味だけ**を通知し、色・速度・太さはShell側のtokenが決める。UIの静止色は白黒に留め、色は状態表示にだけ使う（状態表示だけに色を割り当てる原則）。

```ts
panel.setActivity({
  busy: boolean,
  progress: { kind: "determinate", value } | { kind: "indeterminate" },
  layers: [{ surface, tone, effect }],
});
```

- **surface**: `header`（tabのtint）/ `border`（Panel外周）/ `divider`（stripと内容の境界線）/ `content`（内部mist）
- **tone**: `neutral`（activity1-5の虹彩）/ `info` / `success` / `warning` / `danger`
- **effect**: `static`（実線・定常）/ `flow`（回る帯・流れる線）/ `glow`（脈動）
- progressのdeterminateの`value`は0〜1の割合。範囲外は丸める
- busyは`aria-busy`へ写す。whole-state置き換え、永続化しない、再mountで消える

## 横スワイプの範囲

- **tab帯**: 横スワイプでpageを1つずつ切り替える。tab帯はPanelの中身を持たないので、Panelのscrollと競合しない。
- **Panelの中身**: 横スワイプ・横scrollはPanelだけのもので、外側へは伝えない。

## 用語

| 用語 | 意味 |
|---|---|
| Region | Panelの配置先（left/right/bottom/workspace/pinned）。位置の契約 |
| pinned | Project-scopeのRegion。Areaをまたぐ。中身はwidgetの縦積み（畳んだ状態がindicator） |
| 表示モード | Region内のPanelの出し方。全領域でpagesの1つだけ |
| Panel Frame | Panelの枠（radius）。Regionに依らず同じ輪郭 |
| frame | Shell固有の帯（topbar/statusbar/sidebar）。不透明slab面 |
| activity | Panelの活動状態。Pluginが意味を通知、Shellが描く |

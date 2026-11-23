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
| pinned | Project-scopeの縦領域。Areaをまたいで常時見えるwidgetの置き場（外部サービスの状態・モニター等） | Project |

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
- **widget列**（pinned）: SigmaOS式のSide＋Main。上の行リスト（side）にwidgetの行を並べ、下のmainに選択中の1つだけ中身を見せる。監視・状態確認は「一覧を見て、見たいものを開く」形に揃え、全員を同時に見せる掲示板にはしない。widgetはPanelとは別物で、相互変換（領域をまたぐdragでの移動）はない。widgetの追加は列末尾の「＋」からpickerで選んで新規に作り、並べ替えはpinned列の中だけで行う。

選択中（active）のPanelは各dock・leafの`selected`だけで決まる。pinnedにも`selected`があり、mainに中身を出すwidgetを選ぶ。

### pinned: Side＋Main

pinnedに置くものは全部同じwidget — sideの行として一覧され、選択するとmainに中身が出る。

- **行がwidgetの顔**: sideの1行（タイトル＋hoverで閉じる）がwidgetの常時表示で、activityのtone表示がそのままstatus表示として働く。行のclickで選択し、mainに中身が出る。
- **mainは1つだけ**: 中身を出すのは`selected`のwidgetだけ。選択の切り替えで別のwidgetに乗せ替える（SigmaOSのSide＋Mainと同じ構成）。
- **溢れたらsideだけscrollする**: 行が多くなってもmainの大きさは変わらず、sideの行リストがscrollする。
- Panelの中身のscrollはPanelのもの（pagesと同じ）。

## 面と縁

Shellは「土台の上にタイルを並べる」だけで描く。領域同士の区切りは線ではなく、タイル同士の間に覗く土台色の溝（gap）である。

1. **土台（primary）**: ページ全体と、sidebar・pinned・topbar両端・statusbarのframe領域、そしてmatの内側全面に敷く床（work-bed）。カード間のgapは全部この床が覗くので、溝は領域をまたいで連続して貫く。
2. **タイル（secondary）**: dock（left・right・bottom）・leaf（centerの区画）の各カードと、topbar中央の浮きバー（segment）。全て同じ色・同じ角丸で、borderは持たない。
3. **操作系（tertiary）**: 入力欄、popover・メニュー、hover、選択中のtab・pinnedの行、実行中の強調。タイルの内側にだけ使う。

| token | 使う場所 | Dark | Light |
|---|---|---|---|
| `--plugumi-colors-background-primary` | 土台・frame・床（溝） | #121212 | #FFFFFF |
| `--plugumi-colors-background-secondary` | タイル（dock・leaf・segmentバー）、Panelの面 | #1E1E1E | #F1F1F1 |
| `--plugumi-colors-background-tertiary` | 入力欄・popover・hover・選択中のtab | #2D2D2D | #E5E5E5 |

- **区切りは溝が担う**: カードはborderを引かない。隣り合うカードの間は溝1つだけで、「border｜溝｜border」の二重区切りにしない。溝の幅は`--work-gap`（4px）で、カードの四方は必ず溝に面する。
- **tab帯はカードのheader**: dock・leafは「tab帯（header）＋中身」の1枚のカード。tab帯と中身の間はhairline（divider面）で区切る。
- Panelの面は領域によらずsecondaryで統一し、Shellが敷く。Panelの最背面は透明にして、Shellが敷いた面の色をそのまま使う。pinnedのwidgetはPanelとは別のmount（WidgetMount）だが、mainはframeの床の上に直接載せるので面を別に敷かない。sideの行と選択行の強調だけtertiaryを使う。

### タイルの輪郭

- **浮きバー**: topbarでは中央のwork区間（segment）だけが浮きバーになる。左右のtool群（sidebar・pinnedの開閉などframeの操作）はframeに直置きし、バーには含めない。バーは四辺ともgapで離す。
- **splitはsegment方式**: centerをsplitすると、分割したleaf同士は溝で離れるが、regionの外縁の角だけが丸い。splitの内側の辺は直角にして溝を真っ直ぐに通し、外からは1枚のカードの輪郭に見える（Googleのlist viewのsegment方式）。leafの各辺が外縁かどうかはsplit木で伝播する（`Edges`）。
- dockカードは領域全体で1枚なので全角丸い。pinned列はframe領域なのでタイルを持たず、sideの行とmainの中身が床の上に直接並ぶ。sideとmainの間はhairline（divider面）で区切る。

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

// pinned: Projectに1つ。widgetの順序つきリストと、mainに出す選択
type PinnedWidget = { panel: PanelRef };
type PinnedState = { version: 1; widgets: PinnedWidget[]; selected: string | null };
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
| pinned | Project-scopeのRegion。Areaをまたぐ。中身はSide（行リスト）＋Main（選択widgetの中身）の2段 |
| 表示モード | Region内のPanelの出し方。全領域でpagesの1つだけ |
| Panel Frame | Panelの枠（radius）。Regionに依らず同じ輪郭 |
| frame | Shell固有の帯（topbar/statusbar/sidebar）。不透明slab面 |
| activity | Panelの活動状態。Pluginが意味を通知、Shellが描く |

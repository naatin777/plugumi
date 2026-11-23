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
┌────────────┬──────────────────────────┬──────────┐
│  Area list │        Main              │   Sub    │
│ ────────── │  ┌────┬──────────┬────┐  │ AreaView │
│ Main       │  │left│  center  │right│ │          │
│ Sub        │  ├────┴──────────┴────┤  │          │
│            │  │       bottom       │  │          │
└────────────┴──└────────────────────┘──┴──────────┘
   （topbarは上、statusbarは下の横帯）
```

画面は上から OS帯・本体・ステータス帯 の3段。本体は**Area list**（左の列）と、その右の広い**Main**と右端の**Sub**からなる。

| 領域 | 役割 | スコープ |
|---|---|---|
| Area list | Shellのナビ中枢。AreaをMain・Subの2セクションに並べる（SigmaOSと同じ形）。行をPanelではなくAreaが占める | shell固有（Panelではない） |
| Main | Main listで選択中のAreaを表示する。URLの`/<core>/<project>/<area>/…`が正本で、Main行のclickはそのURLへの移動になる | shell |
| Sub | Sub listで選択中のAreaを右に表示する。開閉でき、閉じるとMainが全幅になる（幅はResizerで調整）。Subは**centerだけ**を描き、dock（left・bottom・right）は出さない（そのAreaをMainへ移せばdockは戻る） | shell |
| left / bottom / right | Areaの中のWorkspaceの縁領域。位置が契約（left=一覧系、bottom=terminal系の横広、right=右の列でMainの脇に置く補助）。開閉できる | Area |
| center | 作業面。splitの木で区画に分けてパネルを配置する | Area |

MainとSubの中身はどちらも同じ**AreaView**である。同じAreaをMainとSubに同時に出してもよい。Areaの中身は従来どおりleft・center（splitの木）・bottom・rightのDock構成で、Panelの置き場所は全部Area-scopeである。「pin」や「widget」という別種のPanelは存在しない。

**Area list**: Projectをまたいで任意のAreaをどのセクションにも入れられる。行のメニューから「Mainへ / Subへ」の移動と表示形式の切替（プロトタイプでは`"full"`=全dockと`"center"`=centerだけの2種）、「リストから外す」を行う。表示形式を切り替えてもPanelの配置は保たれ、見せ方だけが変わる。

## 領域のモデル

### 位置が契約

left・bottom・rightは機能の区切りではなく**位置の契約**である。

- 位置は形状を決める（縦帯=高く狭い、bottom=横に広く低い）
- 位置は規約を運ぶ（filesは左、terminalは下、補助は右 — クロスアプリで学習済み）
- 位置はtoggleの同一性を持つ（⌘1・⌘2等の固定キーに紐づく）
- 位置は永続化のアドレスになる（bottomにあったものはbottomに帰る）

領域に固有なのは位置だけで、中身のPanel・表示モード・開閉は全部自由である。

### スコープはAreaで1段

Panelの置き場所は全部Area-scopeで、Areaのレイアウトと一緒に保存され、切替で入れ替わる（`getWorkspace`/`putWorkspace`）。Project-scopeのPanel置き場は持たない。Main/Subへの割り当てはArea listの状態として端末（localStorage）に保存し、Workspaceとは別に持つ。

### 表示モード

表示方式は全領域で共通の**pages**だけである。centerはsplitの木で区画に分け、並べて見たいPanelはsplitで並べる。

- **pages**（left・bottom・right・centerのleaf）: tab帯に全Panelのtabを並べ、中身は1つのPanelだけを見せる。Panelは画面外にも本来の大きさのまま横に並んでおり、切り替えると横にスライドする。見えていないPanelは大きさを保ったまま描画だけを止める（`content-visibility: hidden`）。
- **切り替え**: tabの選択、tab帯の上での横スワイプ（1回で1つ隣へ）、前後のキー、マウスの戻る・進むボタンで行う。
- **自由な横scrollはしない**: 中身（Panelの上）での横スワイプ・横scrollはPanelのものとし、外側へ伝えない（`overscroll-behavior-x: contain`）。中身の横scrollでpageが変わる、斜めの縦scrollでpageが動く、ブラウザの「戻る」が発動する、を避けるためである。

選択中（active）のPanelは各dock・leafの`selected`だけで決まる。

### Area list: Main/Subセクション

Area listはAreaを**Main**・**Sub**の2セクションで一覧する（SigmaOSのsidebarと同じ形）。行はPanelではなくAreaである。

- **Main**: 行のclickでそのAreaのURLへ移動し、Mainに表示する。URLのAreaがlistに無ければ追加して選択する（deep link）。
- **Sub**: 行のclickでそのAreaをSub領域に表示する。Subは開閉でき、閉じるとMainが全幅になる。
- **別windowで開く（detach）**: 行メニューからそのAreaを別windowで開く。Electronのみ（Webは項目自体を出さない）。detached windowはtitle帯最小限＋そのAreaのAreaView1個（Main扱い＝dockあり）だけを描く。
- **追加は「＋」からpicker**: 各セクションの「＋ Areaを追加」はProject/Areaのツリーから選ぶpopoverを開く。Area・Projectの作成もここで行う。

### 列ごとの開閉ボタン

title barのwork区間はMainとSubで2つに分かれ、それぞれの列の真上にボタン群が並ぶ。どの列のボタンかは位置と境界線で分かるようにする。

- **Mainのsegment**: MainのAreaのcrumb・「+」・検索・`[左][下][右]`のdock開閉。
- **Sub側**: SubのAreaのcrumb（clickでMainへ移動）・「+」。Subはcenterだけの表示なのでdock開閉ボタンは持たない。Subが閉じている・drawerのときはこの区画自体を出さない（幅0に畳まれる）。Subの開閉ボタンはtitle右端の操作群の先頭に固定で置き、drawer時はSub drawerを開閉する。
- dockの開閉状態（`dockOpen[kind]`）はMain用だけ（Subはcenterだけなので）。⌥⌘2〜4はMainのdockを開閉する。
- dockの幅・高さ（`dockSize`）は両slotで共通。

### 幅に応じたdrawer化

幅判定はResizeObserverで行い、計測値は信号（`shellSize`/`size`）と`data-size`属性の両方に反映する。drawerの開閉はJS側でも扱うのでcontainer queryだけにはしない。

| 範囲 | 判定 | 通常 | drawer |
|---|---|---|---|
| AreaView（`.area-view`の幅） | ≥1000px `wide` | dockはinline | — |
| | 600–999px `narrow` | bottomはinline | left・rightがcenterの上に重なるdrawer |
| | <600px `compact` | — | left・right・bottom全部drawer |
| Shell（`main.shell`の幅） | ≥1100px `wide` | Subはinlineの列 | — |
| | 800–1099px `medium` | Area listはinline | Subが右からdrawer（`min(subWidth, 90%)`） |
| | <800px `compact` | — | Area listも左からdrawer（`min(sidebarWidth, 85%)`） |

- **drawerの開閉は一時的**: drawer化した領域はprefsではなくAreaView/Shellごとのsignalで開閉し、初期は閉。狭くなった瞬間に保存済みの「開」がcenterを覆わないため。同じボタン・ショートカットがdrawerのときはこのsignalを切り替える。同時に開くdock drawerはAreaViewごとに1つ。
- **閉じ方**: drawerの外をpointerdownするかEscape。drawerでもPanelはunmountしない（`data-closed`で畳む、transformで画面外へ逃がす）。
- Subがdrawerのとき、Sub側の区画は出さず、開閉はtitle右端のSub開閉ボタンがdrawerを切り替える。

## 面と縁

Shellは「土台の上にタイルを並べる」だけで描く。外側のframe領域（Area list・title帯・status帯）は枠・角丸・溝の無い平らな面で、列の区切りは境界線だけが担う。

1. **土台（primary）**: ページ全体と、Area list・title帯・status帯のframe領域、そしてmatの内側全面に敷く床（work-bed）。カード間のgapは全部この床が覗くので、溝は領域をまたいで連続して貫く。
2. **タイル（secondary）**: dock（left・bottom・right）・leaf（centerの区画）の各カード。全て同じ色・同じ角丸で、borderは持たない。
3. **操作系（tertiary）**: 入力欄、popover・メニュー、hover、選択中のtab・navの行、実行中の強調。タイルの内側にだけ使う。

| token | 使う場所 | Dark | Light |
|---|---|---|---|
| `--plugumi-colors-background-primary` | 土台・frame・床（溝） | #121212 | #FFFFFF |
| `--plugumi-colors-background-secondary` | タイル（dock・leaf）、Panelの面 | #1E1E1E | #F1F1F1 |
| `--plugumi-colors-background-tertiary` | 入力欄・popover・hover・選択中のtab・navの行 | #2D2D2D | #E5E5E5 |

- **frameの区切りは境界線が担う**: frame領域（Area list・title帯・status帯）は平らな面で、列の間は「Area list｜Main」と「Main｜Sub」の縦1px線（`--plugumi-colors-border`）2本だけがtitle帯上端からstatus帯の上まで通る。Subが閉・drawerならMain｜Subの線は出さず、Area listが閉・drawerならArea list｜Mainの線も出さない。Area listとSubの幅のResizerはこの線の上に置く（掴む範囲は線の左右数px、hoverで線を強調）。タイル同士の区切りは従来どおり溝（`--work-gap`）が担い、カードはborderを引かない。
- **tab帯はカードのheader**: dock・leafは「tab帯（header）＋中身」の1枚のカード。tab帯と中身の間はhairline（divider面）で区切る。
- Panelの面は領域によらずsecondaryで統一し、Shellが敷く。Panelの最背面は透明にして、Shellが敷いた面の色をそのまま使う。

### タイルの輪郭

- **title帯は平ら**: title帯に枠・溝は無く、ボタン群は境界線で分かれた区画にただ並ぶ。Main区画の左端はsidebar列の端に揃え、Sub区画はSub列の真上に置く。右端の操作群（Sub開閉・両サイド・テーマ・もや・設定）はtitle帯の右端に並べる。
- **splitはsegment方式**: centerをsplitすると、分割したleaf同士は溝で離れるが、regionの外縁の角だけが丸い。splitの内側の辺は直角にして溝を真っ直ぐに通し、外からは1枚のカードの輪郭に見える（Googleのlist viewのsegment方式）。leafの各辺が外縁かどうかはsplit木で伝播する（`Edges`）。
- dockカードは領域全体で1枚なので全角丸い。

## 保存の形

Workspace（Areaごと）の保存内容は、Shellが所有するJSONである。Web PluginのサーバーとElectron Pluginは中身を解釈せずに保存し、そのまま返す。Shellは読み込み時に形を検査し、形が合わない内容は空のWorkspaceとして扱う（移行はしない）。

```ts
type PanelRef = { instanceId: string; pluginId: string; panelId: string };

// left・bottom・right: tab切替の1列
type Stack = { panels: PanelRef[]; selected: string | null };

// center: splitの木
type Leaf = { kind: "leaf"; id: string; panels: PanelRef[]; selected: string | null };
type Split = { kind: "split"; id: string; axis: "x" | "y"; ratio: number; first: Node; second: Node };
type Node = Leaf | Split;

// workspace = Areaの中のdock構成（left・bottom・center・right）
type WorkspaceState = {
  version: 1;
  left: Stack; bottom: Stack; right: Stack;
  center: { root: Node; focusedLeaf: string };
};
```

- 1つのPanel Instanceは、Workspaceのどこか1箇所にだけ置かれる。
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

- **surface**: `header`（tab・nav行のtint）/ `border`（Panel外周）/ `divider`（stripと内容の境界線）/ `content`（内部mist）
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
| Region | Panelの配置先（left/bottom/right/centerのleaf）。位置の契約 |
| Area list | 左の列。AreaをMain・Subの2セクションに並べる |
| Main | 本体の広い領域。Main listの選択中Areaを表示する（URLが正本） |
| Sub | 本体の右の領域。Sub listの選択中Areaを表示し、開閉できる |
| 表示モード | Region内のPanelの出し方。全領域でpagesの1つだけ |
| 表示形式 | Areaの見せ方。`"full"`（全dock）と`"center"`（centerだけ） |
| Panel Frame | Panelの枠（radius）。Regionに依らず同じ輪郭 |
| frame | Shell固有の帯（topbar/statusbar/sidebar）。不透明slab面 |
| activity | Panelの活動状態。Pluginが意味を通知、Shellが描く |

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
│ Floating   │  │       bottom       │  │          │
└────────────┴──└────────────────────┘──┴──────────┘
   （topbarは上、statusbarは下の横帯）
```

画面は上から OS帯・本体・ステータス帯 の3段。本体は**Area list**（左の列）と、その右の広い**Main**と右端の**Sub**からなる。

| 領域 | 役割 | スコープ |
|---|---|---|
| Area list | Shellのナビ中枢。AreaをMain・Sub・Floatingの3セクションに並べる（SigmaOSと同じ形）。行をPanelではなくAreaが占める | shell固有（Panelではない） |
| Main | Main listで選択中のAreaを表示する。URLの`/<core>/<project>/<area>/…`が正本で、Main行のclickはそのURLへの移動になる | shell |
| Sub | Sub listで選択中のAreaを右に表示する。開閉でき、閉じるとMainが全幅になる（幅はResizerで調整） | shell |
| left / bottom / right | Areaの中のWorkspaceの縁領域。位置が契約（left=一覧系、bottom=terminal系の横広、right=右の列でMainの脇に置く補助）。開閉できる | Area |
| center | 作業面。splitの木で区画に分けてパネルを配置する | Area |

MainとSubの中身はどちらも同じ**AreaView**である。同じAreaをMainとSubに同時に出してもよい。Areaの中身は従来どおりleft・center（splitの木）・bottom・rightのDock構成で、Panelの置き場所は全部Area-scopeである。「pin」や「widget」という別種のPanelは存在しない。

**Area list**: Projectをまたいで任意のAreaをどのセクションにも入れられる。行のメニューから「Mainへ / Subへ / Floatingへ」の移動と表示形式の切替（プロトタイプでは`"full"`=全dockと`"center"`=centerだけの2種）、「リストから外す」を行う。表示形式を切り替えてもPanelの配置は保たれ、見せ方だけが変わる。

**Floating**: 行のclickでそのAreaを別windowで開く。Webは別URL（`?window=floating`付きの新タブ）、Electronは新しいBrowserWindow。Floating windowはArea list・Subなしで、そのAreaView1個だけを全面に描く。

## 領域のモデル

### 位置が契約

left・bottom・rightは機能の区切りではなく**位置の契約**である。

- 位置は形状を決める（縦帯=高く狭い、bottom=横に広く低い）
- 位置は規約を運ぶ（filesは左、terminalは下、補助は右 — クロスアプリで学習済み）
- 位置はtoggleの同一性を持つ（⌘1・⌘2等の固定キーに紐づく）
- 位置は永続化のアドレスになる（bottomにあったものはbottomに帰る）

領域に固有なのは位置だけで、中身のPanel・表示モード・開閉は全部自由である。

### スコープはAreaで1段

Panelの置き場所は全部Area-scopeで、Areaのレイアウトと一緒に保存され、切替で入れ替わる（`getWorkspace`/`putWorkspace`）。Project-scopeのPanel置き場は持たない。Main/Sub/Floatingへの割り当てはArea listの状態として端末（localStorage）に保存し、Workspaceとは別に持つ。

### 表示モード

表示方式は全領域で共通の**pages**だけである。centerはsplitの木で区画に分け、並べて見たいPanelはsplitで並べる。

- **pages**（left・bottom・right・centerのleaf）: tab帯に全Panelのtabを並べ、中身は1つのPanelだけを見せる。Panelは画面外にも本来の大きさのまま横に並んでおり、切り替えると横にスライドする。見えていないPanelは大きさを保ったまま描画だけを止める（`content-visibility: hidden`）。
- **切り替え**: tabの選択、tab帯の上での横スワイプ（1回で1つ隣へ）、前後のキー、マウスの戻る・進むボタンで行う。
- **自由な横scrollはしない**: 中身（Panelの上）での横スワイプ・横scrollはPanelのものとし、外側へ伝えない（`overscroll-behavior-x: contain`）。中身の横scrollでpageが変わる、斜めの縦scrollでpageが動く、ブラウザの「戻る」が発動する、を避けるためである。

選択中（active）のPanelは各dock・leafの`selected`だけで決まる。

### Area list: Main/Sub/Floatingセクション

Area listはAreaを**Main**・**Sub**・**Floating**の3セクションで一覧する（SigmaOSのsidebarと同じ形）。行はPanelではなくAreaである。

- **Main**: 行のclickでそのAreaのURLへ移動し、Mainに表示する。URLのAreaがlistに無ければ追加して選択する（deep link）。
- **Sub**: 行のclickでそのAreaをSub領域に表示する。Subは開閉でき、閉じるとMainが全幅になる。
- **Floating**: 行のclickでそのAreaを別windowで開く。
- **追加は「＋」からpicker**: 各セクションの「＋ Areaを追加」はProject/Areaのツリーから選ぶpopoverを開く。Area・Projectの作成もここで行う。

## 面と縁

Shellは「土台の上にタイルを並べる」だけで描く。領域同士の区切りは線ではなく、タイル同士の間に覗く土台色の溝（gap）である。

1. **土台（primary）**: ページ全体と、sidebar・topbar両端・statusbarのframe領域、そしてmatの内側全面に敷く床（work-bed）。カード間のgapは全部この床が覗くので、溝は領域をまたいで連続して貫く。
2. **タイル（secondary）**: dock（left・bottom・right）・leaf（centerの区画）の各カードと、topbar中央の浮きバー（segment）。全て同じ色・同じ角丸で、borderは持たない。
3. **操作系（tertiary）**: 入力欄、popover・メニュー、hover、選択中のtab・navの行、実行中の強調。タイルの内側にだけ使う。

| token | 使う場所 | Dark | Light |
|---|---|---|---|
| `--plugumi-colors-background-primary` | 土台・frame・床（溝） | #121212 | #FFFFFF |
| `--plugumi-colors-background-secondary` | タイル（dock・leaf・segmentバー）、Panelの面 | #1E1E1E | #F1F1F1 |
| `--plugumi-colors-background-tertiary` | 入力欄・popover・hover・選択中のtab・navの行 | #2D2D2D | #E5E5E5 |

- **区切りは溝が担う**: カードはborderを引かない。隣り合うカードの間は溝1つだけで、「border｜溝｜border」の二重区切りにしない。溝の幅は`--work-gap`（4px）で、カードの四方は必ず溝に面する。
- **tab帯はカードのheader**: dock・leafは「tab帯（header）＋中身」の1枚のカード。tab帯と中身の間はhairline（divider面）で区切る。
- Panelの面は領域によらずsecondaryで統一し、Shellが敷く。Panelの最背面は透明にして、Shellが敷いた面の色をそのまま使う。

### タイルの輪郭

- **浮きバー**: topbarでは中央のwork区間（segment）だけが浮きバーになる。左右のtool群（sidebar開閉などframeの操作）はframeに直置きし、バーには含めない。バーは四辺ともgapで離す。左端はsidebar列の端に揃え、右端は窓の端まで伸ばす（右の列はmatの内側のdockなので揃える対象はtool群だけ）。
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
| Area list | 左の列。AreaをMain・Sub・Floatingの3セクションに並べる |
| Main | 本体の広い領域。Main listの選択中Areaを表示する（URLが正本） |
| Sub | 本体の右の領域。Sub listの選択中Areaを表示し、開閉できる |
| Floating | Areaを別windowで開く表示形式。AreaView1個だけを描く |
| 表示モード | Region内のPanelの出し方。全領域でpagesの1つだけ |
| 表示形式 | Areaの見せ方。`"full"`（全dock）と`"center"`（centerだけ） |
| Panel Frame | Panelの枠（radius）。Regionに依らず同じ輪郭 |
| frame | Shell固有の帯（topbar/statusbar/sidebar）。不透明slab面 |
| activity | Panelの活動状態。Pluginが意味を通知、Shellが描く |

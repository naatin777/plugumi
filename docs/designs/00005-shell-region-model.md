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
| pinned | Project-scopeの縦領域。Areaをまたいで常時見える面（外部サービスの状態・モニター等） | Project |

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

表示方式はpagesの1つだけである。left・right・bottom・pinned・centerの各leafは、どれも同じpagesで中身を見せる。centerはsplitの木で区画に分け、並べて見たいPanelはsplitで並べる。

- **pages**: tab帯に全Panelのtabを並べ、中身は1つのPanelだけを見せる。Panelは画面外にも本来の大きさのまま横に並んでおり、切り替えると横にスライドする。見えていないPanelは大きさを保ったまま描画だけを止める（`content-visibility: hidden`）。
- **切り替え**: tabの選択、tab帯の上での横スワイプ（1回で1つ隣へ）、前後のキー、マウスの戻る・進むボタンで行う。
- **自由な横scrollはしない**: 中身（Panelの上）での横スワイプ・横scrollはPanelのものとし、外側へ伝えない（`overscroll-behavior-x: contain`）。中身の横scrollでpageが変わる、斜めの縦scrollでpageが動く、ブラウザの「戻る」が発動する、を避けるためである。

選択中（active）のPanelは各dock・leafの`selected`だけで決まる。

## 面と縁

Shellの背景は奥から3層を重ねて描く。Darkでは手前ほど明るく、Lightでは手前ほどグレーが濃い。

1. **土台**: ページ全体。窓の四隅や、work面の角を切った部分にはこの色が見える。
2. **frame領域**: topbarの左右区間、sidebar、pinnedの周り、statusbar。土台と同じ色の1枚の面として続く。
3. **work面**: left・center・right・bottomの4領域を包む面と、topbarの中央区間（work区間）を合わせた図形。土台より手前に浮いている。内側には、centerの区画を包むもう1つの面（center面）がある。

- **Panelは自分の縁を持つ**: Panelの枠は`1px border + radius`を持つ。領域の区切り線は引かず、Panelの形が区切りを兼ねる。
- **tab帯はカードのheader**: dock（left・right・bottom・pinned）・centerのleafは、それぞれ「tab帯（header）＋中身」の1枚のカードである。tab帯はカードの輪郭の内側の上端に置き、中身との間はhairline（divider面）で区切る。
- **背景は3段**: 次の3つのtokenで塗る。区切り線ではなく面の明るさの差を区切りにする。

| token | 段 | 使う場所 | Dark | Light |
|---|---|---|---|---|
| `--plugumi-colors-background-primary` | 最奥 | 土台、frame（topbarの左右区間・sidebar・pinnedの周り・statusbar） | #121212 | #FFFFFF |
| `--plugumi-colors-background-secondary` | 手前 | work面（4領域を包む面とtopbarのwork区間）、Panelのカード（dock・leaf・pinned） | #1E1E22 | #F1F3F4 |
| `--plugumi-colors-background-tertiary` | さらに手前 | center面、入力欄、popover・メニュー、hover、選択中のtab、実行中の強調 | #2D2D33 | #E5E7EB |

- work面とカードは同じ色で、カードは1pxの縁で区切る。領域の区切りはwork面の形（輪郭とカードの間の溝）が担う。
- **center面**: centerの区画の中は一段明るいtertiaryの床が敷かれ、frame→work面→center面で内側ほど明るいグラデーションになる。床は常に長方形で、dockのカードの縁まで届き、dockを閉じた側ではwork面の内縁まで届く。角は外側の面と同じ半径で丸め、dockカードの縁との接点では丸めた分だけ下のwork面が覗いてフィレットになる。leafのカードはこの床の上に置かれ、1pxの縁で区切る。
- Panelの面は領域によらずsecondaryで統一し、Shellが敷く。Panelの最背面は透明にして、Shellが敷いた面の色をそのまま使う。

### work面の形

work面の形は、topbarの左右に何をどれだけ表示するかと、sidebar・pinnedの幅で決まる。長方形・凸形（上が下より狭い）・きのこ形（上が下より広い）のどれにもなりうる。左右はそれぞれ独立に決まる。

- 下の部分（4領域を包む面）の左端はsidebarの右端、右端はpinnedの左端に一致する。
- topbarのwork区間の左端は、topbar左区間の右端に置く。topbar左区間の幅は、OSの操作領域（`env(titlebar-area-x)`）とShellのボタン群の幅を足したものである。sidebarの幅は見ない。右端も同じ規則で、topbar右区間の左端に置く。
- 左右それぞれ、上下の端の差を段差`d`とする。work区間が内側にあれば凸、外側にあればきのこになる。どちらの向きでも、外側の凸角と内側の凹角を半径`min(R, d/2)`の2つの弧（S字）で繋ぐ。段差がなければ直線で繋ぐ。
- きのこのとき、work区間はsidebarやpinnedの上まで伸び、sidebar・pinnedはwork区間の下から始まる。
- 段差`d`が24px未満のときは段差を作らず、work区間の端を下の部分の端に揃えて長方形にする。細かいS字を出さないため、また、sidebar・pinnedの幅を少し変えたくらいでは形を変えないためである。
- 形は、sidebar幅・pinned幅・OSの操作領域・ボタン群の幅という既知の値だけから計算する。描画後の要素の位置を読み取って形を決めることはしない。

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

// pinned: Projectに1つ。left・rightと同じtab切替の1列
type PinnedState = { version: 1 } & Stack;
```

- 1つのPanel Instanceは、Workspace・Pinnedのどこか1箇所にだけ置かれる。
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
| pinned | Project-scopeのRegion。Areaをまたぐ。中身はleft・rightと同じtab切替 |
| 表示モード | Region内のPanelの出し方。全領域でpagesの1つだけ |
| Panel Frame | Panelの枠（縁+radius）。Regionに依らず同じ輪郭 |
| frame | Shell固有の帯（topbar/statusbar/sidebar）。不透明slab面 |
| activity | Panelの活動状態。Pluginが意味を通知、Shellが描く |

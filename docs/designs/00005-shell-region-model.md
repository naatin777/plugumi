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
│ Projects    │    workspace     │ right  │ shelf  │
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
| workspace | 作業面。split（tabs tree）または横scroll列でパネルを配置する | Area |
| shelf | Project-scopeの積層領域。Areaをまたいで常時見える面（外部サービスの状態・モニター等） | Project |

## 領域のモデル

### 位置が契約

left・right・bottom・shelfは機能の区切りではなく**位置の契約**である。

- 位置は形状を決める（縦帯=高く狭い、bottom=横に広く低い）
- 位置は規約を運ぶ（filesは左、terminalは下 — クロスアプリで学習済み）
- 位置はtoggleの同一性を持つ（⌘1・⌘2等の固定キーに紐づく）
- 位置は永続化のアドレスになる（bottomにあったものはbottomに帰る）

領域に固有なのは位置だけで、中身のPanel・表示モード・開閉は全部自由である。

### スコープは2段

Panelの置き場所がそのままスコープになる。「pin」という概念やpanelの状態フラグは存在しない。

- **Project-scope**: shelf。Areaを切り替えても入れ替わらない。Project単位で保存（`getShelf`/`putShelf`）
- **Area-scope**: sidebar以外の全領域。Areaのレイアウトと一緒に保存され、切替で入れ替わる（`getWorkspace`/`putWorkspace`）

スコープはPanelの中身が持つ性質（worktreeのFilesはarea-scopeでしか意味を持たない）であり、領域はその公開先でしかない。

### 表示モードは2種

縦領域は2つの表示モードのどちらかで中身を見せる。

- **tab切替**: dockのtab strip。1つのPanelを見せて切り替える
- **積層**: 全Panelを縦に積む。shelfは常時このモード。sidebar内のsections（Projects/Areas/Files相当）も積層

積層モードのセクションは個別に折畳みと高さ変更（resizer）ができる。セクション数は実用上2-3が上限で、それ以上は折畳み運用になる。

## 面と縁

- **輝度の階段**: canvas → subtle（frame slab）→ surface（Panel）→ raised の段で面を区別する。区切り線ではなく面の輝度差が区切り
- **frameは不透明な1枚面**: topbar・statusbar・sidebar・shelf・dock縁は全てsurface-subtleで統一する。半透明にすると位置依存の色滲みが出る（実験で実証済み）
- **Panelは自分の縁を持つ**: `.dock-card`等のPanel枠は`1px border + radius`。領域の区切り線は引かず、「Panelの形」が区切りを兼ねる。隣がframeでもPanelでも同じ見た目になり、ライフサイクル（移動・再mount）で見た目が変わらない
- **内側の辺はcanvas溝、外周はflush**: resizerがcanvas色の溝として領域間に現れる。窓の外周に溝は置かない（外周gapは浮遊カードに見える）

## Activity表示

Pluginは`context.setActivity`で**意味だけ**を通知し、色・速度・太さはShell側のtokenが決める。UIの静止色は白黒に留め、色は状態表示にだけ使う（状態表示だけに色を割り当てる原則）。

```ts
panel.setActivity({
  busy: boolean,
  progress: { kind: "determinate", value } | { kind: "indeterminate" },
  layers: [{ surface, tone, effect }],
});
```

- **surface**: `header`（tabやshelf-headのtint）/ `border`（Panel外周）/ `divider`（stripと内容の境界線）/ `content`（内部mist）
- **tone**: `neutral`（activity1-5の虹彩）/ `info` / `success` / `warning` / `danger`
- **effect**: `static`（実線・定常）/ `flow`（回る帯・流れる線）/ `glow`（脈動）
- busyは`aria-busy`へ写す。whole-state置き換え、永続化しない、再mountで消える

## 横scrollとゾーン

workspaceのscrollモードは横スクロールの競合を持つ。ゾーンはこう分ける。

- **strip（各列のheader帯）は常に外側scroll域** — 内部scrollを持たないので迷いゼロ
- **Panel内部は内側優先** — 端まで行くとscroll chainingで外側へ自然に連鎖
- **resizer溝・列の隙間も外側域** — hoverで外側域と示せる

stripが「header兼外側scroll域」として機能するため、stripは表示だけでなくジェスチャーの境界でもある。

## 用語

| 用語 | 意味 |
|---|---|
| Region | Panelの配置先（left/right/bottom/workspace/shelf）。位置の契約 |
| shelf | Project-scopeの積層Region。旧称Pinned。Areaをまたぐ |
| 表示モード | Region内のPanelの出し方。tab切替 / 積層 |
| Panel Frame | Panelの枠（縁+radius）。Regionに依らず同じ輪郭 |
| frame | Shell固有の帯（topbar/statusbar/sidebar）。不透明slab面 |
| activity | Panelの活動状態。Pluginが意味を通知、Shellが描く |

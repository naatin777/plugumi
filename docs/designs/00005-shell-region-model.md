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

> 注意: [Decision 00030](../decisions/00030-environment-and-project-model.md)に従い、概念階層は Project > Area > Workspace > Panel とする。AreaとWorkspaceの対応関係は現時点では確定しない。このdesignの保存形式とArea-scopeの記述は現行実装寄りの前提を含むため、詳細は実装時に見直す。

## 対応するrequirement

[Requirement 00004](../requirements/00004-common-protocol-contracts.md)は人間がPluginの機能を画面から利用することを求めている。本書は[Design 00004](00004-web-plugin-screen-hierarchy.md)の階層（Core > Project > Area > Workspace）の下で、Shellがパネルをどの領域にどう配置するかを定める。

## 画面の構成

```
┌────────────┬──────────────────────┬──────────┐
│  Area list │        Main          │   Sub    │
│ ────────── │  ┌────────────────┐  │ AreaView │
│ Main       │  │     center     │  │          │
│ Sub        │  │   (splitの木)  │  │          │
│            │  └────────────────┘  │          │
└────────────┴──└──────────────────┘──┴──────────┘
   （topbarは上、statusbarは下の横帯）
```

画面は上から OS帯・本体・ステータス帯 の3段。本体は**Area list**（左の列）と、その右の広い**Main**と右端の**Sub**からなる。

| 領域 | 役割 | スコープ |
|---|---|---|
| Area list | Shellのナビ中枢。AreaをMain・Sub・Detachの3セクションに並べる（SigmaOSと同じ形）。行をPanelではなくAreaが占める | shell固有（Panelではない） |
| Main | Main listで選択中のAreaを表示する。URLの`/<core>/<project>/<area>/…`が正本で、Main行のclickはそのURLへの移動になる | shell |
| Sub | Sub listで選択中のAreaを右に表示する。開閉でき、閉じるとMainが全幅になる（幅はResizerで調整） | shell |
| center | 作業面。splitの木で区画に分けてパネルを配置する | Area |

MainとSubの中身はどちらも同じ**AreaView**である。PanelにはCore経由のPlugin Panelのほか、Shell組み込みPanel（`providerId` `"shell"`）がある — Coreを経由せずShellが直接mountし、picker・配置・workspace保存は同じ扱い（テーマ切替Panelなど）。同じAreaをMainとSubに同時に出してもよい。Areaの中身はcenterのsplit treeだけ — 「縁に置く」（旧left・bottom・rightのdockに相当する配置）は利用者がtreeの端にleafを作ることで表現し、固定の縁領域は存在しない。Panelの置き場所は全部Area-scopeである。「pin」や「widget」という別種のPanelは存在しない。

**Area list**: 今のProjectの全AreaをMain・Sub・Detachの3セクションで一覧する（Areaを隠すことはできない）。行のメニューから「Mainへ / Subへ」の移動、「別windowで開く」（Detachへの移動）、「子Areaを追加」「Areaを削除」（確認あり）を行う。

## 領域のモデル

### 縁はtreeの形で表す

Workspaceが持つのはcenterのsplit treeだけで、Areaの縁に固定された領域（旧left・bottom・right）は存在しない。「下に常設のterminalを置く」ような使い方は、利用者がrootを分割して下端にleafを作ることで実現する — 位置の契約はshellの構造ではなく利用者の配置になる。

### スコープはAreaで1段

Panelの置き場所は全部Area-scopeで、Areaのレイアウトと一緒に保存され、切替で入れ替わる（`getWorkspace`/`putWorkspace`）。Project-scopeのPanel置き場は持たない。Area listの保存は差分だけ（後述）。

### 表示モード

表示方式はleafごとに**pages**か**deck**を選ぶ。並べて常時見せたいPanelはsplitで区画を分けて並べ、deckは1つのleaf内で列見出しを横に流し見する用途に使う。

- **pages**（各leafの既定）: tab帯に全Panelのtabを並べ、中身は1つのPanelだけを見せる。Panelは画面外にも本来の大きさのまま横に並んでおり、切り替えると横にスライドする。見えていないPanelは大きさを保ったまま描画だけを止める（`content-visibility: hidden`）。
- **deck**: pagesと同じ横scroll containerを保ったまま、各Panelを固定幅の列として並べる。TweetDeckのように複数列を同時に見渡せる。列の境目をdragすると全列の幅をまとめて変え、その幅はleafに保存される。scroll中はviewportの中央に掛かる列を選択中として追従する。
- **切り替え**: tab帯右端のトグルでpagesとdeckを切り替える。Panel自体の切り替えは、tabの選択、tab帯・Panelの中身の上での横スワイプ、前後のキー、マウスの戻る・進むボタンで行う。中身は横scrollのcontainer（`overflow-x: auto`＋`scroll-snap-type: x mandatory`）なので、追従・momentum・端での跳ね返り・snap back・中身scroll優先（scroll chaining）はすべてネイティブに任せる。ブラウザの「戻る/進む」が発動しないよう`overscroll-behavior-x: contain`を付ける。

選択中（active）のPanelは各leafの`selected`だけで決まる。

### Area list: Main/Sub/Detachセクション

Area listは**今のProjectの全Area**を**Main**・**Sub**・**Detach**の3セクションで一覧する（SigmaOSのsidebarと同じ形）。行はPanelではなくAreaである。上部にProjectの切替（現在のProject名を押すと一覧popover、ここから「Projectを追加」もできる）。

- **表示はProjectのtreeから導出**し、Areaを一覧として保存しない（隠しAreaは存在しない）。保存するのはProjectごとの差分だけである:

  ```ts
  type AreaListState = {
    version: 1;
    sub: string[];                        // SubセクションのAreaのpath key（並び順）
    selectedSub: string | null;           // Subに表示中
    detached: string[];                   // DetachセクションのAreaのpath key（並び順）
  };
  ```

  path keyはpathの各segmentを`encodeURIComponent`して`/`で継いだ文字列。保存先はlocalStorageの`plugumi:shell:area-list:<coreKey>:<project>`（Projectごとに読み替える）。Main = 全Areaのうち`sub`にも`detached`にも無いもの（tree順・入れ子はインデント）、Sub・Detach = 各キー配列の順でtreeに実在するものだけ（消えたAreaは表示から外すだけで、保存は掃除しない）。配置は3slotで排他 — 「Subへ」「別windowで開く」等の移動は他slotから外すことも含む。
- **Main**: 行のclickでそのAreaのURLへ移動し、Mainに表示する（Mainの選択はURLが正本）。行メニュー: 「Subへ」「別windowで開く」「子Areaを追加」「Areaを削除」（確認あり。「<name> とその下のAreaを削除します」）。
- **Sub**: 行のclickでそのAreaをSub領域に表示する（Subが閉じていれば開く）。Subは開閉でき、閉じるとMainが全幅になる。行メニュー: 「Mainへ」「別windowで開く」「子Areaを追加」「Areaを削除」。
- **Detach**: 別windowに出すと印を付けたArea（Electronのみ — `host.windows`のbridgeが無い環境かつ未使用なら節自体を出さない）。行のclickでそのAreaのdetached windowを開く（毎回新規 — windowの開閉は保存せず、閉じていても行は残る）。行メニュー: 「Mainへ」「Subへ」「子Areaを追加」「Areaを削除」。
- **別windowで開く（detach）**: 行メニューからそのAreaをDetachへ移して別windowで開く。Electronではpreloadのbridge経由でBrowserWindowを開く。detached windowはtitle帯最小限＋そのAreaのAreaView1個だけを描く。
- **「＋ Areaを追加」は新規作成**（表示名titleの入力。親はProject直下、発行されるkeyはserverが決める）。Subの「＋」で作ったAreaはそのままSubへ入る。「子Areaを追加」は行メニューから。Areaが0個のProjectでは各セクションに案内文を出す。

### 列ごとの開閉ボタン

title barのwork区間は1つ。列の開閉や位置には追従せず、区画の端は左右のtool群の自然幅で決まる。

- **work区間**: 「+」だけ。宛先は最後に触ったArea（`focusedArea`、無ければMain）。
- **Sub側**: 区画は置かない。Subの開閉ボタンはtitle右端の操作群の先頭に固定で置き、drawer時はSub drawerを開閉する。
- ⌥⌘1はArea list、⌥⌘2はSubの開閉。

### 幅に応じたdrawer化

幅判定はResizeObserverで行い、計測値は信号（`shellSize`）と`data-size`属性の両方に反映する。drawerの開閉はJS側でも扱うのでcontainer queryだけにはしない。

| 範囲 | 判定 | 通常 | drawer |
|---|---|---|---|
| Shell（`main.shell`の幅） | ≥1100px `wide` | Subはinlineの列 | — |
| | 800–1099px `medium` | Area listはinline | Subが右からdrawer（`min(subWidth, 90%)`） |
| | <800px `compact` | — | Area listも左からdrawer（`min(sidebarWidth, 85%)`） |

> **改訂（2025-11）**: wideでのSub開閉アニメをwidthのtransitionから負margin方式に変えた。以前はpane自体の幅を0→rawへtransitionしていたため、panelの中身ごと潰しながら動いて見た目が不自然だった。現在はpaneの幅を常に`--sub-raw-width`で固定し、`margin-right: calc(var(--sub-width) - var(--sub-raw-width))`でmargin-boxの幅だけを0→rawへ滑らせる — 中身は潰れず再配置も起きず、台ごと右からslideして入るように見える。layout上の语义は変わらない（wideではinlineの列で、開くとMainが縮む）。

- **drawerの開閉は一時的**: drawer化した領域はprefsではなくShellごとのsignalで開閉し、初期は閉。狭くなった瞬間に保存済みの「開」がcenterを覆わないため。同じボタン・ショートカットがdrawerのときはこのsignalを切り替える。開くdrawerはshell全体で1つ — 新しく開くと他（Area list・Sub）は畳まれる。台同士が重ならないため。
- **scrim**: drawerが開いている間、台のすぐ下・外clickで閉じる範囲（作業域全体。横線2本の間、app bar・status barは暗くしない）に薄い暗幕（`--plugumi-colors-scrim`、ぼかしなし）を敷く。暗くする範囲の中の他の境界線はscrimで一緒に暗くなり、幕はpointerを通す（閉じる判定は従来どおり外click）。
- **閉じ方**: drawerの外をpointerdownするかEscape。drawerでもPanelはunmountしない（`data-closed`で畳む、transformで画面外へ逃がす）。
- **drawerの見た目は「台」**: Area listのdrawer（画面<800）とSubのdrawer（画面<1100）は四角い不透明の台が端にぴったり付く（Area listは画面左端、Subは右端、上下は横線まで）、center側の辺にだけ1px線。台の境界線にもresizerがあり、inlineと同じ幅の値（`sidebarWidth`/`subWidth`）を共有して変更できる。台ごとslideして開閉し、閉じ終わったら不可視。
- Subがdrawerのとき、Sub側の区画は出さず、開閉はtitle右端のSub開閉ボタンがdrawerを切り替える。

## 面と縁

Shellは「土台の上にタイルを並べる」だけで描く。外側のframe領域（Area list・title帯・status帯）は枠・角丸・溝の無い平らな面で、列の区切りは境界線だけが担う。

1. **土台（primary）**: ページ全体と、Area list・title帯・status帯のframe領域、そしてmatの内側全面に敷く床（work-bed）。カード間のgapは全部この床が覗くので、溝は領域をまたいで連続して貫く。
2. **タイル（secondary）**: leaf（centerの区画）の各カード。全て同じ色・同じ角丸で、borderは持たない。
3. **操作系（tertiary）**: 入力欄、popover・メニュー、hover、選択中のtab・navの行、実行中の強調。タイルの内側にだけ使う。

| token | 使う場所 | Dark | Light |
|---|---|---|---|
| `--plugumi-colors-background-primary` | 土台・frame・床（溝） | #121212 | #FFFFFF |
| `--plugumi-colors-background-secondary` | タイル（leaf）、Panelの面 | #1E1E1E | #F1F1F1 |
| `--plugumi-colors-background-tertiary` | 入力欄・popover・hover・選択中のtab・navの行 | #2D2D2D | #E5E5E5 |

- **frameの区切りは境界線が担う**: frame領域（Area list・title帯・status帯）は平らな面で、区切りは`--plugumi-colors-border`の1px線が担う。**横線2本**（app barの下端とstatus barの上端）は全幅で常に通し、**縦線2本**（Area list｜MainとMain｜Sub）はその2本の横線の間だけを通る。Subが閉・drawerならMain｜Subの線は出さず、Area listが閉・drawerならArea list｜Mainの線も出さない。Area listとSubの幅のResizerは縦線の上に置く（掴む範囲は線の左右数px、hoverで線を強調）。タイル同士の区切りは溝が担い、カードはborderを引かない。AreaView内のタイル同士（splitの葉同士）の溝は`--area-gap`（8px）で、AreaViewのタイル群の外周（境界線・横線・窓端との間）は`--area-pad`（8px）の余白を取る。
- **tab帯はカードのheader**: leafは「tab帯（header）＋中身」の1枚のカード。tab帯と中身の間はhairline（divider面）で区切る。tab自体に枠線・outline・shadowの線は引かず、選択は面（tertiary）＋文字色で示し、focusedなleafの選択tabだけ文字を`text-strong`にする。
- Panelの面は領域によらずsecondaryで統一し、Shellが敷く。Panelの最背面は透明にして、Shellが敷いた面の色をそのまま使う。

### タイルの輪郭

- **title帯は平ら**: title帯に枠・溝は無く、ボタン群は境界線で分かれた区画にただ並ぶ。区画の端は列の開閉ではなくtool群の自然幅で決まり、右端にはSub開閉ボタンだけを先頭（Sub列寄り）に固定で置く。
- **タイルは独立**: leafのカードは4角とも同じ角丸を持つ独立タイル。splitの内側だから角を落とす段階は無く、カード同士は溝を挟んでただ並ぶ。

## 保存の形

Workspace（Areaごと）の保存内容は、Shellが所有するJSONである。Web appのサーバーは中身を解釈せずに保存し、そのまま返す。ElectronはWeb appの画面を開くため、Workspaceの保存も同じWeb appが担う。Shellは読み込み時に形を検査し、形が合わない内容は空のWorkspaceとして扱う（移行はしない）。

```ts
// inputは開き時の入力（editorのfile pathなど）。Workspaceと一緒に永続化され、
// reloadで復元される。JSON直列化できる値に限る。なおinputは「同じものを
// もう一度開くための情報」であって編集中の状態ではない — dirtyな編集内容
// などの復元はこの仕組みの対象外とする。
// stateはpanelが自分で書くrestorable state（UIの状態 — 選択・展開・
// directoryなど）。inputは開く側が一度だけ渡すのに対し、stateは開かれた
// panel自身がsaveStateで更新する。同じくWorkspaceと一緒に永続化される。
// 書き込みはdebounce済みのWorkspace保存に乗るため、頻度は人間の操作
// 速度程度を想定し、scroll位置のような高頻度のものは対象外とする。
// dirtyな編集内容はinputと同じく対象外。
type PanelRef = { instanceId: string; providerId: string; panelId: string; input?: unknown; state?: unknown };

// leaf: tab切替の1区画。layout省略時はpages。colWidthはdeckの列幅（px）
type Leaf = {
  kind: "leaf";
  id: string;
  panels: PanelRef[];
  selected: string | null;
  layout?: "pages" | "deck";
  colWidth?: number;
};
type Split = { kind: "split"; id: string; axis: "x" | "y"; ratio: number; first: Node; second: Node };
type Node = Leaf | Split;

// workspace = centerのsplit tree
type WorkspaceState = {
  version: 1;
  center: { root: Node; focusedLeaf: string };
};
```

- 1つのPanel Instanceは、Workspaceのどこか1箇所（どれかのleaf）にだけ置かれる。
- Panelは木のleafにだけ置く。木とは別のPanel一覧は持たない。
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

- **tab帯**: 横スワイプでpageを1つずつ切り替える。tab帯はPanelの中身を持たないので、Panelのscrollと競合しない。tabはタイトルが数文字読める最小幅（`min(6em, 100%)`）までしか縮まず、溢れた分はtab帯自体の横scroll（縦ホイールでもscrollできる）。「×」は選択中のtabだけ常に出し、非選択tabはhover/focus時だけタイトルの上へ重ねて出す。
- **Panelの中身**: pages・deckのviewportはどちらも横scroll containerなので、中身がその方向へ横scrollできる間は中身がscrollし、端まで行くとscroll chainingでそのままviewportへ流れてpageやdeckの列がずれる — 優先順位の判定コードは要らず、ネイティブのscroll chainingがそのまま目的の挙動になる。scroll中はscroll位置から選択中をliveにtabへ反映し、gesture由来でないscroll（Panel内の`scrollIntoView`など）は収まった時点で選択中のpageへ戻す（scroll container化の副作用として、`scrollIntoView`がviewportまでscrollさせてpageをずらすことがあるため）。

## 用語

| 用語 | 意味 |
|---|---|
| leaf | Panelの配置先（split木の葉）。tab帯＋中身の1枚のカード |
| Area list | 左の列。AreaをMain・Sub・Detachの3セクションに並べる |
| Main | 本体の広い領域。Main listの選択中Areaを表示する（URLが正本） |
| Sub | 本体の右の領域。Sub listの選択中Areaを表示し、開閉できる |
| 表示モード | leaf内のPanelの出し方。pagesまたはdeck |
| Panel Frame | Panelの枠（radius）。leafに依らず同じ輪郭 |
| frame | Shell固有の帯（topbar/statusbar/sidebar）。不透明slab面 |
| activity | Panelの活動状態。Pluginが意味を通知、Shellが描く |

## 改訂（Area listの開閉も負margin方式・reload時のflash修正）

Area list（左列）のinline開閉もSubと同じ負marginslide方式に揃えた —
paneの幅は常に`--sidebar-raw-width`で固定し、`margin-left: calc(var(--side-width) - var(--sidebar-raw-width))`でmargin-boxの幅だけを滑らせる。中身は潰れず、閉じた姿はpaneがshellのclipの外（左）へはみ出した状態。開閉中のfocus隔離は`data-closed`のvisibility遅延が担い、sidebarの中身はsub-paneと同じく常時mountとする（閉じる途中で中身が消えないように）。

また`shellSize`の初期値は常に`"wide"`だったため、狭い窓ではwideのlayoutで一瞬paintされてからResizeObserverの修正でdrawerへ飛び、reload時にArea listが一瞬見えるflashになっていた。ref callback内で初回paint前に`offsetWidth`を同期的に測り、正しいsizeで初回paintするように修正した。

---
type: decision
title: component primitiveの配置・命名とspacing 3層 doctrine、CSS整理の課題
description: view-core/components.cssを唯一の正典とするcomponent体系と命名規則、listのspacing分業を記録し、場当たり的編集で残ったCSSの整理課題を列挙する。
status: draft
---

## 決定

### componentの正典と命名

- component classは全て`plugumi-`prefix — style labに載るものは全て公開（plugin-facing）
- 定義は`packages/view-core/src/design/components.css`の1ファイルだけ。値は`var(--plugumi-*)`のみで、hostのtokens.cssが値を定義する（00038の3層）
- shellはapp-uiのindex.tsがglobal import、pluginはshadow rootにadopt — 誰も値や見た目を複写しない
- 現 inventory: plugumi-button / plugumi-input / plugumi-list / plugumi-list-item(-meta, --selected/--danger) / plugumi-icon-button(--armed) / plugumi-tab(-title/-close/--selected)

### 縦リストはcontainer+itemのペア

- menu・nav・picker・sidebarの「縦に並ぶ選択/操作項目」は1つのprimitive: list item
- 名前はlist-item（navでも意味が正しいため menu-itemではない）
- 解剖学: [icon?] + label + [meta?]

### spacingの3層 doctrine（B方式）

- container（plugumi-list）のpadding — 外周の息（drawerの縁との空気）
- 行はfull-bleed — 選択barもclick/hoverも端まで届く。marginで行を狭めない（hit areaが削れる逆効果）
- itemのpadding-inline — 文字のinsetはここで作る
- popoverとの併用注意: `plugumi-list`のdisplay:flexがpopoverの閉状態を上書きするため`[popover]:not(:popover-open)`でdisplay:noneを維持する

### component hover/focusの素材

- list item: hover=fill、selected=fill-strong+text-strong
- button/input: 色付き透明（resting=fill、輪郭はborder）。frameの上では透過が無意味なのでicon-button hoverは不透明のまま
- focusはoutlineのみ — border変化と併用すると二重線になる

## 整理課題（フロントエンドCSSがぐちゃぐちゃなので一旦全体を見直す）

場当たり的編集（regex手術を含む）で残った既知の残骸:

1. 未使用の可能性: `.project-add`/`.area-add`（破線言語は廃止）、`.confirm-text`、`core-button`（prefix無しのまま）
2. controls.module.css / sidebar.module.css — regexでpadding等を削った際の残渣・空ルール・コメント不整合の確認
3. `.lab-nav`にplugumi-listとlab.css双方のpaddingが効いている（二重指定の整理）
4. inline styleでclass paddingを殺すパターン（depth indentはcalc加算に直したが、他にも同種がないか）
5. shellのmodule cssに残るべきものは「文脈の配線」だけという原則の徹底 — componentの見た目が残っていないか
6. lab.cssはspecimen用とnav用が混在 — 役割の分離を検討
7. `.strip-deck`等、catalogにないshell部品の扱い（専有chromeとして許容するか）
8. dev loopの注意: view-coreのdistはviteがpre-bundle cacheするため、components.css変更が即反映されないことがある

## 編集上の教訓

- CSSへのregex一括置換は巻き込み事故を起こした（2回）。構造を読んで1ルールずつ直す
- 「直らない」ときはinline style・shadow DOM境界・vite cacheを先に疑う

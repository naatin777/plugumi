---
type: contract
title: PanelのモジュールとWeb Pluginの接続
description: Pluginが提供するPanelのentryがexportする関数、Web Pluginが渡すcontext、CSSの範囲、Panelのライフサイクルを定める。
status: draft
relations:
  decision:
    - '00014'
  contract:
    - '00004'
  requirement:
    - '00004'
---

## 当事者

- **Panelのモジュール**: Pluginが提供するUI Bundleのentry。ESMのJavaScriptファイル。
- **Web Plugin**: entryを読み込み、画面に表示する。

Panelのモジュールは、Web Pluginと同じOriginで、Shadow DOMを使わずに動く（[Decision 00014](../decisions/00014-panel-runs-unisolated.md)）。entryのファイルと宣言の受け渡しは[Contract 00004](00004-plugin-client-protocol.md)の「UIファイルとPanelの宣言」に従う。

## entryがexportするもの

```ts
export function mount(host: HTMLElement, context: PanelContext): PanelHandle | Promise<PanelHandle>;

interface PanelHandle {
  destroy(): void;
}

interface PanelContext {
  // このPanelを提供した登録のToolを呼ぶ。現在はsyncのToolだけに対応する。
  callTool(toolPath: string, input: unknown): Promise<unknown>;
}
```

- Web Pluginは `host` を作って渡す。Panelは `host` の中だけにDOMを作る。`host` には `data-plugumi-plugin="<registrationId>"` が付いている。
- `callTool` は、Toolの結果を返す。Toolがエラーを返したときは、Promiseを拒否する。
- Panelは特定のフレームワークに依存しなくてよい。フレームワークのランタイムはPanelのBundleに含める。
- TypeScriptの型（`PanelContext`・`PanelHandle`）は、配布用のパッケージ `@plugumi/plugin-view` から使える。

## Panelのライフサイクル

Web Pluginは、開いている1つ1つのPanelをPanel Instanceとして扱う。Panel Instanceは、Panelの宣言（Pluginと `panelId`）とは別のもので、Web PluginがIDを振る。同じPanelを複数開くと、それぞれが別のPanel Instanceになる。

| できごと | Web Pluginが行うこと |
|---|---|
| Panelを開く | 新しいPanel Instanceを作り、`mount` を1回呼ぶ |
| タブを切り替える | 表示を隠すだけで、`destroy` も `mount` も呼ばない。DOMはそのまま残る |
| Panelを閉じる・ページを離れる | `destroy` を呼び、Panel Instanceを捨てる |
| UIが更新される（`uiSha256` が変わる） | `destroy` を呼んでから、新しい版のentryで `mount` し直す |
| 提供元の登録がなくなる | 同じPluginの同じPanelの登録が1つだけあれば、それで `mount` し直す。なければ、その旨を表示してPanel Instanceは残す |

Panelは `destroy` で購読やタイマーを片付ける。`mount` し直したとき、Web PluginはPanelの内部状態を復元しない。

Web Pluginは、表示に失敗した理由を次の3つに分けて示し、同じPanel Instanceのまま再試行できるようにする。

| 分類 | 意味 |
|---|---|
| `load` | entryを読み込めなかった |
| `contract` | entryが `mount` をexportしていない |
| `mount` | `mount` が例外を投げた、または拒否された |

## CSS

Shadow DOMを使わないので、CSSは画面全体で共有される。Web Pluginは、CSSが意図せず他へ当たらないように、次の範囲を設ける。この範囲は見た目のためのもので、セキュリティの境界ではない。

- **Web Plugin自身のCSS**: `@scope (:root) to ([data-plugumi-plugin])` の中に書き、Panelの入れ物の手前で止める。Panelに届くのは、Token（CSS変数）と、文字色やフォントなどの継承される値だけである。
- **PanelのCSS**: Panelの宣言の `styles` に、UI BundleのCSSファイルを書く。Web Pluginはそれを `@scope ([data-plugumi-plugin="<registrationId>"]) to ([data-plugumi-plugin])` で包んで読み込む。Panelの中に別のPluginのUIが入った場合、包んだCSSはそこで止まる。`@keyframes` と `@font-face` は `@scope` の中に置けないので、範囲を絞らずにそのまま読み込む。`@import` は使えない。

Panelは、見た目をそろえたい場合、次のTokenを `var()` で参照できる。値はWeb Pluginが決め、Dark/Lightは `:root` の `data-plugumi-theme` で切り替わる。

| 種別 | 名前の例 |
|---|---|
| 色 | `--plugumi-colors-background-primary`、`--plugumi-colors-background-secondary`、`--plugumi-colors-background-tertiary`、`--plugumi-colors-text`、`--plugumi-colors-text-muted`、`--plugumi-colors-border`、`--plugumi-colors-accent`、`--plugumi-colors-error` |
| 文字 | `--plugumi-font-family-sans`、`--plugumi-font-family-mono`、`--plugumi-font-size-md`、`--plugumi-font-weight-semibold`、`--plugumi-line-height-md` |
| 余白・角丸 | `--plugumi-spacing-xs` 〜 `--plugumi-spacing-xl`、`--plugumi-radii-sm` 〜 `--plugumi-radii-lg` |

Tokenの名前は `@plugumi/plugin-view` の `tokenNames` でも参照できる。値の正本は、Plugin Shellの `shared/plugin-shell/src/styles/tokens.css` とする。

Panelの最背面は透明にする。Panelの面はShellが領域によらず `--plugumi-colors-background-secondary` で敷く（Design 00005「面と縁」）。Panelが自分で最背面を塗る必要はなく、Tokenで面の色を塗るのはPanel内部で面を分けたい要素に限る。

## Shell組み込みPanel

Plugin経由ではなくShellが直接mountするPanel（`kind: "builtin"`、`pluginId`は`"shell"`）もある。Coreのpanels一覧とは別にShell側の一覧に加わり、picker・workspace保存・復元では同じPanelとして扱われる。組み込みは本contractの `mount(host, context)` ではなくShell内部の `BuiltinPanelMount`（`mount(host, shell)`）で呼ばれ、styles・uiSha256・registrationIdは持たない（更新追従・再mountも行わない）。最初の組み込みはテーマ切替Panel（`panelId: "theme"`）。

## 未決定

- `async` のToolの途中出力と取消
- Panelの初期パラメータ、状態の保存と復元
- Panelのタイトルやバッジを動的に変える方法
- 共通の部品とその見た目の取り決め（Style Contract）

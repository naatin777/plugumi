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

Panelのモジュールは、Web Pluginと同じOriginで動き、Panel InstanceごとのShadowRootの中にDOMを作る（[Decision 00014](../decisions/00014-panel-runs-unisolated.md)）。Shadow DOMは見た目を分けるためのもので、信頼の境界ではない。entryのファイルと宣言の受け渡しは[Contract 00004](00004-plugin-client-protocol.md)の「UIファイルとPanelの宣言」に従う。

## entryがexportするもの

```ts
export function mount(host: ShadowRoot, context: PanelContext): PanelHandle | Promise<PanelHandle>;

interface PanelHandle {
  destroy(): void;
}

interface PanelContext {
  // このPanelのShadowRoot。mountに渡すhostと同じもの。
  root: ShadowRoot;
  // このPanelを提供した登録のToolを呼ぶ。現在はsyncのToolだけに対応する。
  callTool(toolPath: string, input: unknown): Promise<unknown>;
  // このPanelを開いたときの初期入力。openPanelの第2引数がそのまま届く。
  input?: unknown;
  // 同じleafの自分の隣に、同じPluginの別Panelを開く。
  openPanel(panelId: string, input?: unknown): void;
}
```

- `host` は、そのPanel Instance専用のShadowRootである。Panelは `host` の中だけにDOMを作る。ShadowRootを持つhost要素には `data-plugumi-plugin="<registrationId>"` が付いている。
- popover・tooltip・dialogなど、Panelの並びの外に置きたい要素は `context.root`（`host`と同じShadowRoot）へappendする。documentやbody直下へ出すと、Panel自身のCSSがその要素に届かない。
- `callTool` は、Toolの結果を返す。Toolがエラーを返したときは、Promiseを拒否する。
- `openPanel` で開いたPanelは、自分を開いたPanelの隣（leaf内の次の位置）に挿入され、その新しいPanelの `context.input` に第2引数が届く。`input` は実行時だけの値で、workspaceへは保存されず再mountでも届かない。開けるのは同じPluginのPanelだけ（他PluginのPanelを指定することはできない）。
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

Panelは専用のShadowRootの中に描かれるので、CSSはShadow DOMの境界で分かれる。この分離は見た目のためのもので、セキュリティの境界ではない — PanelのJSはdocumentを直接触れる。

- **Web Plugin自身のCSS**: document側のCSSとして書く。Shadow DOMを越えないのでPanelには届かず、Panelに届くのはToken（CSS変数）と、文字色やフォントなどの継承される値だけである。
- **PanelのCSS**: Panelの宣言の `styles` に、UI BundleのCSSファイルを書く。Web PluginはそれをそのPanelのShadowRootにだけ適用する（`adoptedStyleSheets`）。`@keyframes` もshadow内で閉じるため、他のPanelやWeb Pluginと名前が衝突しない。`@font-face` はshadow内では登録できないため、Web Pluginがdocument側へ出す — 画面全体で共有され、名前の衝突はPanel側が避ける。`@import` は使えない。

Panelは、見た目をそろえたい場合、次のTokenを `var()` で参照できる。値はWeb Pluginが決め、Dark/Lightは `:root` の `data-plugumi-theme` で切り替わる。

| 種別 | 名前の例 |
|---|---|
| 色 | `--plugumi-colors-background-primary`、`--plugumi-colors-background-secondary`、`--plugumi-colors-background-tertiary`、`--plugumi-colors-text`、`--plugumi-colors-text-muted`、`--plugumi-colors-border`、`--plugumi-colors-accent`、`--plugumi-colors-error` |
| 文字 | `--plugumi-font-family-sans`、`--plugumi-font-family-mono`、`--plugumi-font-size-md`、`--plugumi-font-weight-semibold`、`--plugumi-line-height-md` |
| 余白・角丸 | `--plugumi-spacing-xs` 〜 `--plugumi-spacing-xl`、`--plugumi-radii-sm` 〜 `--plugumi-radii-lg` |

Tokenの名前は `@plugumi/plugin-view` の `tokenNames` でも参照できる。値の正本は、Plugin Shellの `shared/workbench/src/styles/tokens.css` とする。

Panelの最背面は透明にする。Panelの面はShellが領域によらず `--plugumi-colors-background-secondary` で敷く（Design 00005「面と縁」）。Panelが自分で最背面を塗る必要はなく、Tokenで面の色を塗るのはPanel内部で面を分けたい要素に限る。

## Shell組み込みPanel

Plugin経由ではなくShellのbundleに同梱されるPanel（`kind: "builtin"`、`providerId`は`"shell"`）もある。Coreのpanels一覧とは別にShell側の一覧に加わり、picker・workspace保存・復元では同じPanelとして扱われる。

組み込みも本contractの `mount(host, context)` で呼ばれ、`host`はPluginと同じShadowRoot。違うのはコードとstyleの来所だけで、module fetchの代わりにbundle同梱の`mount`を呼び、Core経由の`styles` fetchの代わりに同梱されたCSSテキストを`adoptedStyleSheets`へ載せる。contextは`PanelContext`に`shell: ShellController`を足した`BuiltinPanelContext` — 同梱コードなので信頼境界はなく、テーマのような端末localのprefsへはCore Toolではなくこの`shell`で届く（`callTool`は組み込みでは使えない）。`styles`・`uiSha256`・`registrationId`は持たず、一覧の更新追従・再mountも行わない。

組み込みPanelの実体は`shared/`配下の独立package（最初の組み込みはテーマ切替Panel `plugumi-theme-panel`、`panelId: "theme"`）として置き、`shared/workbench`はmountの機構だけを持つ。

## 未決定

- `async` のToolの途中出力と取消
- Panelの状態の保存と復元（開き時の初期入力は `context.input` で渡せるが、workspaceへの永続化は扱わない）
- Panelのタイトルやバッジを動的に変える方法
- 共通の部品とその見た目の取り決め（Style Contract）

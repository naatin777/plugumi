# 00045: プラットフォームprimitiveを手書きの機械に優先する

## 結論

ブラウザのプラットフォームprimitiveで実現できることを、手書きの
JS/CSS機械で実装しない。baselineが揃った時点で移行する。plugumiは
最新ブラウザのみを対象とするため、「今動いているから残す」ではなく
「将来保守する価値があるか」で判断する。

## 移行したもの: popover位置決め

`popover.ts`はanchorの`getBoundingClientRect`を測り、flip判定と
viewport clampingを手書きして`position: fixed`で置いていた（約50行）。
これをCSS anchor positioningに置き換えた:

- `showPopover({ source: anchor })` — sourceがimplicit anchorになる
  （Chrome 137+ / Firefox 144+ / Safari 26+。popovertarget宣言的呼び出し
  でも自動でimplicit anchorが結ばれる）
- CSSは `position-anchor: auto` + `anchor()` inset + `position-try-fallbacks: flip-block`
- 手書きのflip/clampロジックは削除。scroll追従・resize追従・top layerでの
  位置計算はすべてブラウザの責務になった

## 落とし穴: position-anchorの初期値

spec確定まで初期値がimplicit→auto→none→normalと変遷した。現在の
初期値`normal`は`position-area`無しではimplicit anchorを**引かない**。
`anchor()`をimplicit anchorで使うには`position-anchor: auto`の明示が
必須。新しいプラットフォーム機能は初期値に依存せず明示的に書くこと。

## dead code検査

class-usage.test.tsに逆方向（cssで定義されているがソースのどこにも
現れないclass）を追加した。`plugumi-*`はplugin作者向け公開APIなので
対象外。検出はconservative — comment中の言及も参照とみなし、liveな
classの誤削除を防ぐ方向に倒す。導入直後に`theme-check`（theme panelの
shadow CSS内のdead class）を検出・削除した。

## 見送ったもの

- `calc-size()`/`interpolate-size`: Chromiumのみ。plugumiの幅animationは
  登録custom property方式で全ブラウザ動くため不要（解く問題も違う）
- container queriesによるshell sizing: shellSizeはdrawerのstate machineも
  駆動するためCSSだけに移せず、分裂させる利点がない
- `if()`関数: Chrome 137+のみ。早すぎる

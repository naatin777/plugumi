// 手書きのアイコン。16のviewBox、stroke=currentColor、線幅1.5、丸い端子で
// 統一する。外部のicon setは使わない。
import type { JSX } from "@solidjs/web";

type IconProps = { size?: number; style?: JSX.CSSProperties };

const icon = (paths: () => JSX.Element) => (props: IconProps) => (
  <svg
    width={props.size ?? 16}
    height={props.size ?? 16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style={props.style}
  >
    {paths()}
  </svg>
);

// 枠+内部の線で領域を表すアイコン群。外側の列（Area list・Sub）は
// 列を塗りつぶして示す。
export const IconAreaList = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <path
    d="M6 3.25 H3.5 a1.25 1.25 0 0 0 -1.25 1.25 v7 a1.25 1.25 0 0 0 1.25 1.25 H6 Z"
    fill="currentColor" stroke="none"
  />
</>);

export const IconSub = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <path
    d="M10 3.25 h2.5 a1.25 1.25 0 0 1 1.25 1.25 v7 a1.25 1.25 0 0 1 -1.25 1.25 H10 Z"
    fill="currentColor" stroke="none"
  />
</>);

export const IconPlus = icon(() => <>
  <line x1="8" y1="3.5" x2="8" y2="12.5" />
  <line x1="3.5" y1="8" x2="12.5" y2="8" />
</>);

export const IconSearch = icon(() => <>
  <circle cx="7" cy="7" r="4.5" />
  <line x1="10.2" y1="10.2" x2="13.5" y2="13.5" />
</>);

// 設定はスライダー（歯車はlightの太陽と見紛うので使わない）。
export const IconClose = icon(() => <>
  <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" />
  <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" />
</>);

export const IconChevronRight = icon(() =>
  <polyline points="6,3.5 10.5,8 6,12.5" />
);

export const IconChevronDown = icon(() =>
  <polyline points="3.5,6 8,10.5 12.5,6" />
);

// dragの掴み場。6つの点。
export const IconGrip = icon(() => <>
  <circle cx="5.5" cy="3.5" r="0.8" fill="currentColor" stroke="none" />
  <circle cx="10.5" cy="3.5" r="0.8" fill="currentColor" stroke="none" />
  <circle cx="5.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
  <circle cx="10.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
  <circle cx="5.5" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
  <circle cx="10.5" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
</>);

// focus: 枠が引っ込んで中央の作業領域だけ残るイメージ。
// テーマ: system=半分、light=日、dark=月。
// Core一覧やswitcherに使う丸い接続状態はCSSで描くのでアイコンは不要。

export const IconProject = icon(() => <>
  <rect x="2" y="3" width="12" height="10" rx="1.5" />
  <line x1="2" y1="6.5" x2="14" y2="6.5" />
</>);

// deck表示: 枠の中を縦に区切った列のイメージ。
export const IconDeck = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <line x1="6" y1="2.5" x2="6" y2="13.5" />
  <line x1="10" y1="2.5" x2="10" y2="13.5" />
</>);

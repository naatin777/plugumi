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

// 枠+内部の線で領域を表すアイコン群。
export const IconSidebar = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <line x1="6" y1="2.5" x2="6" y2="13.5" />
</>);

export const IconDockLeft = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <line x1="6.5" y1="2.5" x2="6.5" y2="13.5" />
  <line x1="3" y1="5.5" x2="5" y2="5.5" />
  <line x1="3" y1="8" x2="5" y2="8" />
</>);

export const IconDockBottom = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" />
  <line x1="4.5" y1="11.5" x2="11.5" y2="11.5" />
</>);

export const IconDockRight = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <line x1="9.5" y1="2.5" x2="9.5" y2="13.5" />
  <line x1="11" y1="5.5" x2="13" y2="5.5" />
  <line x1="11" y1="8" x2="13" y2="8" />
</>);

export const IconPinned = icon(() => <>
  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
  <line x1="10" y1="2.5" x2="10" y2="13.5" />
  <line x1="11.5" y1="5" x2="13" y2="5" />
  <line x1="11.5" y1="8" x2="13" y2="8" />
  <line x1="11.5" y1="11" x2="13" y2="11" />
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
export const IconSettings = icon(() => <>
  <line x1="2.5" y1="4.5" x2="13.5" y2="4.5" />
  <circle cx="5.5" cy="4.5" r="1.8" />
  <line x1="2.5" y1="8" x2="13.5" y2="8" />
  <circle cx="10.5" cy="8" r="1.8" />
  <line x1="2.5" y1="11.5" x2="13.5" y2="11.5" />
  <circle cx="6.5" cy="11.5" r="1.8" />
</>);

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
export const IconFocus = icon(() => <>
  <polyline points="6,2.5 2.5,2.5 2.5,6" />
  <polyline points="10,2.5 13.5,2.5 13.5,6" />
  <polyline points="6,13.5 2.5,13.5 2.5,10" />
  <polyline points="10,13.5 13.5,13.5 13.5,10" />
</>);

// テーマ: system=半分、light=日、dark=月。
export const IconThemeSystem = icon(() => <>
  <circle cx="8" cy="8" r="5.5" />
  <path d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 Z" fill="currentColor" stroke="none" />
</>);

export const IconThemeLight = icon(() => <>
  <circle cx="8" cy="8" r="3.5" />
  <line x1="8" y1="1" x2="8" y2="3" />
  <line x1="8" y1="13" x2="8" y2="15" />
  <line x1="1" y1="8" x2="3" y2="8" />
  <line x1="13" y1="8" x2="15" y2="8" />
  <line x1="3" y1="3" x2="4.5" y2="4.5" />
  <line x1="11.5" y1="11.5" x2="13" y2="13" />
  <line x1="13" y1="3" x2="11.5" y2="4.5" />
  <line x1="4.5" y1="11.5" x2="3" y2="13" />
</>);

export const IconThemeDark = icon(() =>
  <path d="M13 9.5 A5.5 5.5 0 0 1 6.5 3 A5.5 5.5 0 1 0 13 9.5 Z" />
);

// 床のもやもや（aurora）切替。四つ星のきらめき。
export const IconAurora = icon(() =>
  <path d="M8 2 L9.4 6.6 L14 8 L9.4 9.4 L8 14 L6.6 9.4 L2 8 L6.6 6.6 Z" />
);

// Core一覧やswitcherに使う丸い接続状態はCSSで描くのでアイコンは不要。

export const IconProject = icon(() => <>
  <rect x="2" y="3" width="12" height="10" rx="1.5" />
  <line x1="2" y1="6.5" x2="14" y2="6.5" />
</>);

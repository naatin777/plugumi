// responsive幅の契約。plugumiのpanelはsplitで幅が変わるため、
// viewportではなくpanel（container）の幅が適応の基準になる。
// shellとpanelが同じ境界を共有するための正本。
//
// 重要な制約: CSS変数はmedia query・container queryの条件式では
// 使えない（var()はプロパティ値でのみ解決される）。そのため幅の契約は
// tokensとは違いCSS変数を介さず、TSの数値としてexportする。
// - JS側（ResizeObserverで構造やstateを変える場合）はこの値を使う
// - CSS側（container query）は条件式にリテラルを書くしかない。
//   書くときはこの値に合わせること — ずれると境界が二重に存在することになる
//
// 値はusage-drivenに育てる: 実証された境界だけを置き、推测で階層を
// 増やさない。現在の唯一の実証はstyle labのsidebar collapse（560px）。
export const widths = {
  // これ未満ではsidebar等の副構造を畳み、1列を基本とする幅。
  compact: 560,
} as const;

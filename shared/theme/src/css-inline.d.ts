// `import ... from "*.css?inline"` でCSSテキストを得る。
// ShadowRootのadoptedStyleSheetsに渡す用途なので、Viteのcss処理には
// 渡さず文字列のままほしい。
declare module "*.css?inline" {
  const source: string;
  export default source;
}

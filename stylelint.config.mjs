/** @type {import('stylelint').Config} */
export default {
  extends: ["stylelint-config-recommended"],
  ignoreFiles: ["**/dist/**", "**/node_modules/**", "**/dist-ui/**"],
  rules: {
    // Electronの<webview>要素は正当なtype selector。
    "selector-type-no-unknown": [true, { ignoreTypes: ["webview"] }],
    // :disabledと:hover:not(:disabled)のような両立しないstateや、
    // 詳細度で必ず負けるbase ruleをcompoundの後に置く意図的な並びまで
    // 警告されるため無効化（repoの並びは意図がコメントで管理されている）。
    "no-descending-specificity": null,
  },
};

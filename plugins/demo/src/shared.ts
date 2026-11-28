// view⇄runtimeの私的protocol。両端がこのtypeをimportする —
// schema/codegenは要らない（designs/00011）。
export type ViewMessage =
  | { type: "userInput"; text: string }
  | { type: "reset" };
export type RuntimeMessage =
  | { type: "echo"; text: string; seq: number }
  | { type: "farewell" };

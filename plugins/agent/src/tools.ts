// agent pluginが提供するoperation群。
// MVPは agent/echo のみ（自己呼び出しの疎通確認用）。

import type { Operation } from "@plugumi/runtime";

export const agentOperations: Operation[] = [
  {
    path: "agent/echo",
    description: "疎通確認用。入力をそのまま返す。",
    handle: (input) => ({ echo: input, from: "agent" }),
  },
];

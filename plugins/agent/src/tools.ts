// agent pluginが提供するTool群。
// MVPは agent/echo のみ（自己呼び出しの疎通確認用）。

import type { Tool } from "plugumi-plugin-client";

export const agentTools: Tool[] = [
  {
    declaration: { toolPath: "agent/echo", kind: "sync" },
    handler: (input) => ({ echo: input, from: "agent" }),
  },
];

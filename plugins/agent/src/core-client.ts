// agentのCore接続。登録・operation宣言・RPC・catalog追跡の機構は
// @plugumi/runtimeのPluginRuntimeに任せ、agent固有の設定だけを束ねる。
import { PluginRuntime } from "@plugumi/runtime";
import { agentOperations } from "./tools.js";
import { logDiagnostic } from "./log.js";

export { coreURL } from "@plugumi/runtime";

export class CoreClient extends PluginRuntime {
  constructor(url: URL, instanceId: string, token?: string) {
    super({
      url,
      providerId: "agent",
      instanceId,
      token,
      operations: agentOperations,
      // agentは呼び出し側にもなるのでcatalogを追跡する。
      catalog: true,
      log: (message) => logDiagnostic(`[agent] ${message}`),
    });
  }
}

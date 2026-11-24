// agentのCore接続。登録・Tool宣言・RPC・Registry購読の機構は
// plugumi-plugin-clientのPluginClientに任せ、agent固有の設定だけを束ねる。
import {
  METHOD_CALL_CHUNK,
  METHOD_CALL_CLOSE,
  METHOD_CALL_RESULT,
  PluginClient,
} from "plugumi-plugin-client";
import { agentTools } from "./tools.js";
import { logDiagnostic } from "./log.js";

export { coreURL } from "plugumi-plugin-client";

export class CoreClient extends PluginClient {
  constructor(url: URL, pluginInstanceId: string, token?: string) {
    super({
      url,
      pluginId: "agent",
      pluginInstanceId,
      token,
      tools: agentTools,
      // agentは呼び出し側にもなるのでRegistryを購読する。
      catalog: true,
      log: (message) => logDiagnostic(`[agent] ${message}`),
      onNotification: (message) => {
        if ([METHOD_CALL_CHUNK, METHOD_CALL_RESULT, METHOD_CALL_CLOSE].includes(message.method ?? "")) {
          console.log(`\n[out ${message.method}] ${JSON.stringify(message.params)}`);
        }
      },
    });
  }
}

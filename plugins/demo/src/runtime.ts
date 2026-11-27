// demo pluginのruntime。echoに近い振る舞いをview channel越しに行う。
// viewからのuserInputへseq付きのechoを返し、channelのcloseを観察する。
import { PluginRuntime, coreURL } from "@plugumi/runtime";
import type { RuntimeMessage, ViewMessage } from "./shared.js";

const coreArg = process.argv.find((_, index) => process.argv[index - 1] === "--core");
const url = coreURL(coreArg ?? process.env.PLUGUMI_CORE_URL ?? "http://127.0.0.1:3500");

const runtime = new PluginRuntime({
  url,
  providerId: "demo",
  instanceId: `demo-${process.pid}`,
  operations: [
    { path: "demo/echo", description: "demo echo", handle: (input) => ({ echo: input }) },
  ],
  ui: {
    root: new URL("../dist-ui", import.meta.url).pathname,
    panels: [{ panelId: "demo", title: "Demo", entry: "panel.js" }],
  },
  onView(channel) {
    const typed = channel.typed<RuntimeMessage, ViewMessage>();
    let seq = 0;
    typed.onMessage((message) => {
      if (message.type === "userInput") {
        seq += 1;
        typed.send({ type: "echo", text: message.text, seq });
      }
    });
    typed.onClose(() => {
      console.log(`[demo] view channel closed: ${channel.instanceId}`);
    });
    console.log(`[demo] view opened: ${channel.instanceId}`);
  },
  log: (message) => console.log(`[demo] ${message}`),
});

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
await runtime.run(controller.signal);

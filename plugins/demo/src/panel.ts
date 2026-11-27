// demo panelのview entry。defineViewで包むので接続・bind・cleanupは
// SDKが担い、ここではUIと型付きchannelだけを扱う。
import { defineView } from "@plugumi/view";
import type { RuntimeMessage, ViewMessage } from "./shared.js";

export const mount = defineView<ViewMessage, RuntimeMessage>((host, channel) => {
  const log = document.createElement("div");
  log.dataset.part = "demo-log";
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.placeholder = "message";
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "send";
  form.append(input, button);
  host.replaceChildren(log, form);

  const append = (text: string) => {
    const line = document.createElement("p");
    line.textContent = text;
    log.append(line);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input.value) return;
    channel.send({ type: "userInput", text: input.value });
    input.value = "";
  });

  channel.onMessage((message) => {
    if (message.type === "echo") {
      append(`echo #${message.seq}: ${message.text}`);
    }
  });
  channel.onClose(() => append("（channel closed）"));
  append("demo panel ready");

  return {
    destroy() {
      host.replaceChildren();
    },
  };
});

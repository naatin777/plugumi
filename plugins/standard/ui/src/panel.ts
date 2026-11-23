// Panelのentry。web側がdynamic importしてmount(host, context)を呼ぶ。
import { mount as mountComponent, unmount } from "svelte";
import type { PanelContext, PanelHandle } from "@plugumi/plugin-view";
import Panel from "./panel.svelte";

export function mount(host: ShadowRoot, context: PanelContext): PanelHandle {
  const component = mountComponent(Panel, { target: host, props: { context } });
  return {
    destroy: () => {
      void unmount(component);
    },
  };
}

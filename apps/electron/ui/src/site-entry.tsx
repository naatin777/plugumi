// Site Panelのentry。web側がdynamic importしてmount(host, context)を呼ぶ。
import { render } from "@solidjs/web";
import type { PanelContext, PanelHandle } from "@plugumi/plugin-view";
import { SitePanel } from "./site.tsx";
import "./site.css";

export function mount(host: ShadowRoot, context: PanelContext): PanelHandle {
  const dispose = render(() => <SitePanel context={context} />, host);
  return {
    destroy: () => dispose(),
  };
}

// Site Panelのentry。web側がdynamic importしてmount(host, context)を呼ぶ。
import { render } from "@solidjs/web";
import type { ViewContext, ViewHandle } from "@plugumi/view";
import { SitePanel } from "./site.tsx";
import "@plugumi/view/components.css";
import "./site.css";

export function mount(host: ShadowRoot, context: ViewContext): ViewHandle {
  const dispose = render(() => <SitePanel context={context} />, host);
  return {
    destroy: () => dispose(),
  };
}

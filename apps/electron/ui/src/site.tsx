// Webサイトを表示するPanel。中身は<webview> — DOM要素なので
// 位置・clip・z-order・表示切替は全てレイアウトに従う。
// （WebContentsViewをDOMの上に重ねる方式はrect同期が常に遅れ、
// overlayがdrawer等を遮る不安定さがあった — ElectronのwebviewTagを
// 有効にしたwindowでのみ動く）
import { createSignal, onSettled, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ViewContext } from "@plugumi/view";

// <webview>はElectronのwebviewTagで有効化される要素。ブラウザや
// 無効化されたrendererではただのunknown elementになりloadURLを持たない。
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<unknown>;
  getURL(): string;
  getWebContentsId(): number;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

function validURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function SitePanel(props: { context: ViewContext }): JSX.Element {
  const supported = "loadURL" in document.createElement("webview");

  // 開き時の入力（context.openPanelで生えたPanelにだけ来る）。
  // inputはmount時の引数なので、あとからcontextが差し替わっても追わない。
  const inputUrl = untrack(() => (props.context.input as { url?: unknown } | undefined)?.url);
  const home = (typeof inputUrl === "string" ? validURL(inputUrl) : undefined)
    ?? "https://www.google.com";
  const [draft, setDraft] = createSignal(home);
  const [current, setCurrent] = createSignal(home);
  const [canBack, setCanBack] = createSignal(false);
  const [canFwd, setCanFwd] = createSignal(false);

  let container: HTMLDivElement | undefined;
  let view: WebviewElement | undefined;

  onSettled(() => {
    if (!supported || container === undefined) return;

    // SolidのJSX型はElectron固有の<webview>を知らないので、DOM APIで作る。
    // これは通常のDOM要素であり、位置・clip・z-orderはPanelのlayoutに従う。
    view = document.createElement("webview") as WebviewElement;
    view.setAttribute("src", home);
    view.setAttribute("webpreferences", "contextIsolation=yes, sandbox=yes");
    // allowpopups — window.open/target=_blankの要求をmainの
    // setWindowOpenHandlerへ通すために要る。無いとguestの要求は
    // rendererにもmainにも届かず握り潰される。
    view.setAttribute("allowpopups", "");
    container.prepend(view);

    // guest内の遷移をアドレス欄へ反映する。
    const sync = () => {
      const url = view?.getURL() ?? "";
      setCurrent(url === "about:blank" ? "" : url);
      setCanBack(view?.canGoBack() ?? false);
      setCanFwd(view?.canGoForward() ?? false);
    };
    view.addEventListener("did-navigate", sync);
    view.addEventListener("did-navigate-in-page", sync);
    view.addEventListener("dom-ready", sync);

    // guestが新しいwindowを要求したとき（target=_blank・window.open）、
    // main→preload経由で届く。guestIdが自分のwebviewのものだけ拾い、
    // 同じleafの隣に新しいSite Panelを開く。
    const openSibling = (event: Event) => {
      const detail = (event as CustomEvent<{ guestId?: number; url?: string }>).detail;
      if (detail?.guestId !== view?.getWebContentsId()) return;
      const url = validURL(detail.url ?? "");
      if (url !== undefined) props.context.openPanel?.("site", { url });
    };
    window.addEventListener("plugumi:site-open", openSibling);

    return () => {
      window.removeEventListener("plugumi:site-open", openSibling);
      view?.remove();
    };
  });

  const go = () => {
    const url = validURL(draft());
    if (url === undefined || view === undefined) return;
    setCurrent(url);
    void view.loadURL(url);
  };

  return (
    <div class="panel">
      <Show
        when={supported}
        fallback={<p class="unavailable">このPanelはElectronでのみ使えます（webviewが要ります）</p>}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            go();
          }}
        >
          <button
            type="button"
            class="nav"
            disabled={!canBack()}
            onClick={() => view?.goBack()}
            aria-label="戻る"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="10,3.5 5.5,8 10,12.5" />
            </svg>
          </button>
          <button
            type="button"
            class="nav"
            disabled={!canFwd()}
            onClick={() => view?.goForward()}
            aria-label="進む"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6,3.5 10.5,8 6,12.5" />
            </svg>
          </button>
          <input
            type="text"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            placeholder="https://…"
          />
          <button type="submit">移動</button>
        </form>
        <div class="view" ref={(element) => { container = element; }}>
          <Show when={current() === ""}>
            <p class="hint">URLを入力して移動を押してください</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}

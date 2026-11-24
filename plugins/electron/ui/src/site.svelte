<script lang="ts">
  // Webサイトを表示するPanel。中身は<webview> — DOM要素なので
  // 位置・clip・z-order・表示切替は全てレイアウトに従う。
  // （WebContentsViewをDOMの上に重ねる方式はrect同期が常に遅れ、
  // overlayがdrawer等を遮る不安定さがあった — ElectronのwebviewTagを
  // 有効にしたwindowでのみ動く）
  import { onMount } from "svelte";
  import type { PanelContext } from "@plugumi/plugin-view";

  interface Props {
    context: PanelContext;
  }
  let { context }: Props = $props();

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
  const supported = "loadURL" in document.createElement("webview");

  // 開き時の入力（context.openPanelで生えたPanelにだけ来る）。
  const inputUrl = (context.input as { url?: unknown } | undefined)?.url;
  const home = (typeof inputUrl === "string" ? validURL(inputUrl) : undefined)
    ?? "https://www.google.com";
  let draft = $state(home);
  let current = $state(home);
  let view = $state<WebviewElement | undefined>();
  let canBack = $state(false);
  let canFwd = $state(false);

  function validURL(value: string): string | undefined {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  onMount(() => {
    if (!supported || view === undefined) return;
    // guest内の遷移をアドレス欄へ反映する。
    const sync = () => {
      const url = view === undefined ? "" : view.getURL();
      current = url === "about:blank" ? "" : url;
      canBack = view?.canGoBack() ?? false;
      canFwd = view?.canGoForward() ?? false;
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
      if (url !== undefined) context.openPanel("site", { url });
    };
    window.addEventListener("plugumi:site-open", openSibling);
    return () => window.removeEventListener("plugumi:site-open", openSibling);
  });

  function go() {
    const url = validURL(draft);
    if (url === undefined || view === undefined) return;
    current = url;
    void view.loadURL(url);
  }
</script>

<div class="panel">
  {#if !supported}
    <p class="unavailable">このPanelはElectronでのみ使えます（webviewが要ります）</p>
  {:else}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        go();
      }}
    >
      <button
        type="button"
        class="nav"
        disabled={!canBack}
        onclick={() => view?.goBack()}
        aria-label="戻る"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="10,3.5 5.5,8 10,12.5" />
        </svg>
      </button>
      <button
        type="button"
        class="nav"
        disabled={!canFwd}
        onclick={() => view?.goForward()}
        aria-label="進む"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6,3.5 10.5,8 6,12.5" />
        </svg>
      </button>
      <input type="text" bind:value={draft} placeholder="https://…" />
      <button type="submit">移動</button>
    </form>
    <div class="view">
      <!-- allowpopups — window.open/target=_blankの要求をmainの
           setWindowOpenHandlerへ通すために要る。無いとguestの要求は
           rendererにもmainにも届かず握り潰される。 -->
      <webview bind:this={view} src={home} webpreferences="contextIsolation=yes, sandbox=yes" allowpopups></webview>
      {#if current === ""}
        <p class="hint">URLを入力して移動を押してください</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel {
    font-family: var(--plugumi-font-family-sans);
    font-size: var(--plugumi-font-size-md);
    color: var(--plugumi-colors-text);
    background: transparent;
    height: 100%;
    padding: var(--plugumi-spacing-md);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--plugumi-spacing-sm);
  }
  form { display: flex; gap: var(--plugumi-spacing-xs); }
  input {
    flex: 1;
    padding: var(--plugumi-spacing-xs) var(--plugumi-spacing-sm);
    background: var(--plugumi-colors-background-tertiary);
    color: var(--plugumi-colors-text);
    border: 1px solid var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
    font-family: var(--plugumi-font-family-mono);
    font-size: var(--plugumi-font-size-sm);
  }
  button {
    padding: var(--plugumi-spacing-xs) var(--plugumi-spacing-sm);
    background: var(--plugumi-colors-background-tertiary);
    color: var(--plugumi-colors-text);
    border: 1px solid var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
    cursor: pointer;
  }
  button.nav {
    display: inline-flex;
    align-items: center;
    padding: var(--plugumi-spacing-xs);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .view {
    flex: 1;
    position: relative;
    border: 1px dashed var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
    display: flex;
    min-height: 0;
  }
  .view webview {
    flex: 1;
    min-height: 0;
  }
  .hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .hint, .unavailable {
    color: var(--plugumi-colors-text-muted);
    font-size: var(--plugumi-font-size-sm);
  }
</style>

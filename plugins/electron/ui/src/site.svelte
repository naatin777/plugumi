<script lang="ts">
  // Webサイトを表示するPanel。中身は<webview> — DOM要素なので
  // 位置・clip・z-order・表示切替は全てレイアウトに従う。
  // （WebContentsViewをDOMの上に重ねる方式はrect同期が常に遅れ、
  // overlayがdrawer等を遮る不安定さがあった — ElectronのwebviewTagを
  // 有効にしたwindowでのみ動く）
  import { onMount } from "svelte";

  interface Props {
    // mount contractのcontext。今は使わない。
    context: unknown;
  }
  let { context: _context }: Props = $props();

  // <webview>はElectronのwebviewTagで有効化される要素。ブラウザや
  // 無効化されたrendererではただのunknown elementになりloadURLを持たない。
  interface WebviewElement extends HTMLElement {
    loadURL(url: string): Promise<unknown>;
    getURL(): string;
  }
  const supported = "loadURL" in document.createElement("webview");

  let draft = $state("");
  let current = $state("");
  let view = $state<WebviewElement | undefined>();

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
    };
    view.addEventListener("did-navigate", sync);
    view.addEventListener("did-navigate-in-page", sync);
    // target=_blank等はpopupを出さず同じviewで開く。
    view.addEventListener("new-window", (event) => {
      const url = validURL((event as { url?: string }).url ?? "");
      if (url !== undefined && view !== undefined) void view.loadURL(url);
    });
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
      <input type="text" bind:value={draft} placeholder="https://…" />
      <button type="submit">移動</button>
    </form>
    <div class="view">
      <webview bind:this={view} src="about:blank" webpreferences="contextIsolation=yes, sandbox=yes"></webview>
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

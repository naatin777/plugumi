<script lang="ts">
  // Webサイトを表示するPanel。中身はDOMではなくElectronの
  // WebContentsView — プレースホルダのrectをpreload bridge
  // （plugumiSite）でmainへ報告し、mainがviewを重ねる。
  // ブラウザではbridgeが無いので案内だけを出す。
  import { onMount } from "svelte";

  interface Props {
    // mount contractのcontext。今はpanelId発行しか使わない。
    context: unknown;
  }
  let { context: _context }: Props = $props();

  interface SiteBridge {
    attach(id: string, url: string): void;
    bounds(id: string, rect: { x: number; y: number; width: number; height: number }): void;
    navigate(id: string, url: string): void;
    detach(id: string): void;
  }

  const bridge = (window as { plugumiSite?: SiteBridge }).plugumiSite;
  const id = `site-${crypto.randomUUID()}`;

  let draft = $state("");
  let current = $state("");
  let placeholder = $state<HTMLDivElement | undefined>();
  let attached = $state(false);

  function validURL(value: string): string | undefined {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  onMount(() => {
    if (bridge === undefined || placeholder === undefined) return;
    bridge.attach(id, "");
    attached = true;
    const report = () => {
      if (placeholder === undefined) return;
      const r = placeholder.getBoundingClientRect();
      bridge.bounds(id, { x: r.x, y: r.y, width: r.width, height: r.height });
    };
    const observer = new ResizeObserver(report);
    observer.observe(placeholder);
    // scrollやtab切替でrectが変わってもResizeObserverが来ないことがあるので
    // 定期報告でフォローする。
    const timer = setInterval(report, 300);
    report();
    return () => {
      clearInterval(timer);
      observer.disconnect();
      bridge.detach(id);
    };
  });

  function go() {
    const url = validURL(draft);
    if (url === undefined) return;
    current = url;
    bridge?.navigate(id, url);
  }
</script>

<div class="panel">
  {#if bridge === undefined}
    <p class="unavailable">このPanelはElectronでのみ使えます（WebContentsViewが要ります）</p>
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
    <div class="view" bind:this={placeholder}>
      {#if !attached || current === ""}
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
    border: 1px dashed var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .hint, .unavailable {
    color: var(--plugumi-colors-text-muted);
    font-size: var(--plugumi-font-size-sm);
  }
</style>

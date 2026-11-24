<script lang="ts">
  // 内蔵ブラウザ（Electron）のwindowを操作するPanel。
  // electron/window/*のToolをcallToolで呼び、一覧・開閉・screenshotを出す。
  import type { PanelContext } from "@plugumi/plugin-view";

  interface Props {
    context: PanelContext;
  }
  let { context }: Props = $props();

  interface WindowInfo {
    id: number;
    url: string;
    title: string;
    focused: boolean;
  }

  let windows = $state<WindowInfo[]>([]);
  let error = $state("");
  let draft = $state("/");
  // screenshotのプレビュ。window idごとにdata URLを持つ。
  let shots = $state<Record<number, { src: string; width: number; height: number }>>({});

  let generation = 0;

  async function refresh() {
    const current = ++generation;
    context.setActivity({ busy: true, progress: { kind: "indeterminate" } });
    try {
      const result = await context.callTool("electron/window/list", {});
      if (current !== generation) return;
      windows = result as WindowInfo[];
      error = "";
      context.setActivity(null);
    } catch (reason) {
      if (current !== generation) return;
      error = String(reason);
      context.setActivity({ layers: [{ surface: "header", tone: "danger" }] });
    }
  }

  $effect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  });

  async function openWindow() {
    try {
      await context.callTool("electron/window/open", { path: draft });
      error = "";
      await refresh();
    } catch (reason) {
      error = String(reason);
    }
  }

  async function act(toolPath: string, input: unknown) {
    try {
      const result = await context.callTool(toolPath, input);
      error = "";
      return result;
    } catch (reason) {
      error = String(reason);
      return undefined;
    }
  }

  async function focus(id: number) {
    if ((await act("electron/window/focus", { id })) !== undefined) await refresh();
  }

  async function close(id: number) {
    if ((await act("electron/window/close", { id })) !== undefined) {
      const rest = { ...shots };
      delete rest[id];
      shots = rest;
      await refresh();
    }
  }

  async function screenshot(id: number) {
    if (shots[id] !== undefined) {
      const rest = { ...shots };
      delete rest[id];
      shots = rest;
      return;
    }
    const result = (await act("electron/window/screenshot", { id })) as
      | { imageBase64: string; mime: string; width: number; height: number }
      | undefined;
    if (result !== undefined) {
      shots = {
        ...shots,
        [id]: {
          src: `data:${result.mime};base64,${result.imageBase64}`,
          width: result.width,
          height: result.height,
        },
      };
    }
  }
</script>

<div class="panel">
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void openWindow();
    }}
  >
    <input type="text" bind:value={draft} placeholder="/path" />
    <button type="submit">開く</button>
    <button type="button" onclick={() => void refresh()}>更新</button>
  </form>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if windows.length === 0}
    <p class="empty">開いているwindowがありません</p>
  {:else}
    <ul>
      {#each windows as window (window.id)}
        <li>
          <div class="row">
            <span class="id">#{window.id}</span>
            <span class="title">
              {window.title || window.url}
              {#if window.focused}<span class="focused">focused</span>{/if}
            </span>
            <span class="actions">
              <button type="button" onclick={() => void focus(window.id)}>focus</button>
              <button type="button" onclick={() => void screenshot(window.id)}>
                {shots[window.id] === undefined ? "shot" : "hide"}
              </button>
              <button type="button" onclick={() => void close(window.id)}>close</button>
            </span>
          </div>
          <div class="url">{window.url}</div>
          {#if shots[window.id] !== undefined}
            <img class="shot" src={shots[window.id].src} alt="window {window.id}" />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .panel {
    font-family: var(--plugumi-font-family-sans);
    font-size: var(--plugumi-font-size-md);
    line-height: var(--plugumi-line-height-md);
    color: var(--plugumi-colors-text);
    /* 最背面は透明にして、置かれているカードの色をそのまま使う。 */
    background: transparent;
    height: 100%;
    padding: var(--plugumi-spacing-md);
    box-sizing: border-box;
    overflow: auto;
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
    flex-shrink: 0;
    white-space: nowrap;
    padding: var(--plugumi-spacing-xs) var(--plugumi-spacing-sm);
    background: var(--plugumi-colors-background-tertiary);
    color: var(--plugumi-colors-text);
    border: 1px solid var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
    cursor: pointer;
  }
  button:hover {
    background: color-mix(in oklab, var(--plugumi-colors-background-tertiary), var(--plugumi-colors-text) 8%);
  }
  ul { list-style: none; padding: 0; margin: var(--plugumi-spacing-sm) 0; }
  li {
    padding: var(--plugumi-spacing-xs) 0;
    border-bottom: 1px solid var(--plugumi-colors-border);
  }
  .row { display: flex; align-items: baseline; gap: var(--plugumi-spacing-sm); }
  .id {
    color: var(--plugumi-colors-text-muted);
    font-family: var(--plugumi-font-family-mono);
    font-size: var(--plugumi-font-size-xs);
  }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .focused {
    color: var(--plugumi-colors-accent);
    font-size: var(--plugumi-font-size-xs);
    margin-left: var(--plugumi-spacing-xs);
  }
  .actions { display: flex; gap: var(--plugumi-spacing-xs); }
  .actions button { padding: 2px var(--plugumi-spacing-xs); font-size: var(--plugumi-font-size-xs); }
  .url {
    color: var(--plugumi-colors-text-muted);
    font-family: var(--plugumi-font-family-mono);
    font-size: var(--plugumi-font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .shot {
    display: block;
    max-width: 100%;
    margin-top: var(--plugumi-spacing-xs);
    border: 1px solid var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
  }
  .empty { color: var(--plugumi-colors-text-muted); }
  .error { color: var(--plugumi-colors-error); }
</style>

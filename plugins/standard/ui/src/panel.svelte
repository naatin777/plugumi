<script lang="ts">
  import type { PanelContext } from "@plugumi/plugin-view";

  interface Props {
    context: PanelContext;
  }
  let { context }: Props = $props();

  interface Entry {
    name: string;
    kind: string;
    size: number;
  }

  let path = $state(".");
  let draft = $state(".");
  let entries = $state<Entry[]>([]);
  let error = $state("");

  // pathの変更に追従して一覧を取り直す。
  $effect(() => {
    const directory = path;
    error = "";
    context
      .callTool("fs/list", { path: directory })
      .then((result) => {
        entries = (result as { entries: Entry[] }).entries;
      })
      .catch((reason) => {
        error = String(reason);
      });
  });

  function open(entry: Entry) {
    if (entry.kind !== "directory") return;
    path = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
    draft = path;
  }

  function up() {
    if (path === "/" || path === ".") {
      path = "..";
    } else if (path === ".." || path.endsWith("/..")) {
      path = `${path}/..`;
    } else {
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      path = parent;
    }
    draft = path;
  }

  function go() {
    if (draft !== "") path = draft;
  }
</script>

<div class="panel">
  <form
    onsubmit={(event) => {
      event.preventDefault();
      go();
    }}
  >
    <input type="text" bind:value={draft} />
    <button type="submit">移動</button>
    <button type="button" onclick={up}>..</button>
  </form>
  <p class="path">{path}</p>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  <ul>
    {#each entries as entry (entry.name)}
      <li>
        {#if entry.kind === "directory"}
          <button class="entry" onclick={() => open(entry)}>{entry.name}/</button>
        {:else}
          <span class="entry">{entry.name}</span>
          <span class="meta">{entry.kind} {entry.size}B</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .panel {
    font-family: var(--plugumi-font-family-sans);
    font-size: var(--plugumi-font-size-md);
    line-height: var(--plugumi-line-height-md);
    color: var(--plugumi-colors-text);
    background: var(--plugumi-colors-surface);
    height: 100%;
    padding: var(--plugumi-spacing-md);
    box-sizing: border-box;
    overflow: auto;
  }
  form { display: flex; gap: var(--plugumi-spacing-xs); }
  input {
    flex: 1;
    padding: var(--plugumi-spacing-xs) var(--plugumi-spacing-sm);
    background: var(--plugumi-colors-surface-subtle);
    color: var(--plugumi-colors-text);
    border: 1px solid var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
    font-family: var(--plugumi-font-family-mono);
    font-size: var(--plugumi-font-size-sm);
  }
  form button {
    padding: var(--plugumi-spacing-xs) var(--plugumi-spacing-sm);
    background: var(--plugumi-colors-surface-raised);
    color: var(--plugumi-colors-text);
    border: 1px solid var(--plugumi-colors-border);
    border-radius: var(--plugumi-radii-sm);
    cursor: pointer;
  }
  form button:hover { background: var(--plugumi-colors-surface-hover); }
  ul { list-style: none; padding: 0; margin: var(--plugumi-spacing-sm) 0; }
  li { padding: 2px 0; display: flex; align-items: baseline; }
  .entry { font-family: var(--plugumi-font-family-mono); font-size: var(--plugumi-font-size-sm); }
  button.entry {
    background: none;
    border: none;
    color: var(--plugumi-colors-info);
    cursor: pointer;
    padding: 0;
  }
  button.entry:hover { color: var(--plugumi-colors-text-strong); }
  .meta {
    color: var(--plugumi-colors-text-muted);
    font-size: var(--plugumi-font-size-xs);
    margin-left: var(--plugumi-spacing-sm);
  }
  .path {
    color: var(--plugumi-colors-text-muted);
    font-family: var(--plugumi-font-family-mono);
    font-size: var(--plugumi-font-size-xs);
  }
  .error { color: var(--plugumi-colors-error); }
</style>

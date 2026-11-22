import { A } from "@solidjs/router";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useShellHost, type CoreEntry } from "../host";

export default function CoreList() {
  const host = useShellHost();
  const [cores, setCores] = createSignal<CoreEntry[]>([]);
  const [url, setUrl] = createSignal("");
  const [error, setError] = createSignal("");
  const refresh = () => host.listCores().then(setCores).catch((e) => setError(String(e)));
  onMount(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    onCleanup(() => clearInterval(timer));
  });
  const submit = async (event: Event) => {
    event.preventDefault();
    setError("");
    try {
      await host.addCore(url());
      setUrl("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const remove = async (entry: CoreEntry) => {
    setError("");
    try {
      await host.removeCore(entry.url);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <main>
      <h1>Plugumi</h1>
      <form class="add-core" onSubmit={submit}>
        <input
          type="text"
          placeholder="http://127.0.0.1:7700"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
        <button type="submit">追加</button>
      </form>
      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <table>
        <thead>
          <tr><th>Name</th><th>URL</th><th>状態</th><th>source</th><th></th></tr>
        </thead>
        <tbody>
          <For each={cores()}>
            {(entry) => (
              <tr>
                <td>
                  <Show when={entry.key !== ""} fallback={entry.name || "-"}>
                    <A href={`/${entry.key}/`}>{entry.name || entry.key}</A>
                  </Show>
                </td>
                <td>{entry.url}</td>
                <td class={`status-${entry.status}`}>{entry.status}{entry.error ? ` (${entry.error})` : ""}</td>
                <td>{entry.source}</td>
                <td>
                  <Show when={entry.source === "saved"}>
                    <button onClick={() => remove(entry)}>削除</button>
                  </Show>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p class="core-meta"><A href="/lab">Style Lab</A></p>
    </main>
  );
}

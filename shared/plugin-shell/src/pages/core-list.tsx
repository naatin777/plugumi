// Core一覧（/）。追加と削除もここで行う。リンクはURLに使えるkeyを
// 持つCoreだけ — 予約名（api/assets/ui）と同名のCoreはkeyを持たない
// ためリンクしない（designs/00004）。command指定のCoreは削除できない
// だけで、画面遷移はできる。
import { For, Show, createSignal, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref } from "@solidjs/router";

import { useShellHost, type CoreEntry } from "../host.tsx";
import { ConfirmButton } from "../shell/inline.tsx";
import styles from "./core-list.module.css";
import controlStyles from "../shell/controls.module.css";

const statusText = (entry: CoreEntry): string => {
  switch (entry.status) {
    case "connected": return "接続中";
    case "connecting": return "接続しています";
    case "rejected": return entry.error ? `拒否: ${entry.error}` : "拒否されました";
    case "unreachable": return "接続できません";
    default: return "";
  }
};

export default function CoreListPage(): JSX.Element {
  const host = useShellHost();
  const [cores, setCores] = createSignal<CoreEntry[] | undefined>();
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal("");
  const [url, setUrl] = createSignal("");

  const refresh = async () => {
    try {
      setCores(await host.listCores());
    } catch {
      // 一覧が取れなくても追加フォームは出す
    }
  };
  onSettled(() => {
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  });

  const submit = async (event: Event) => {
    event.preventDefault();
    setError("");
    try {
      await host.addCore(url());
      setUrl("");
      setAdding(false);
      await refresh();
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    }
  };

  return (
    <div class={styles["core-list-page"]}>
      <h1>Plugumi</h1>
      <ul class={styles["core-list"]}>
        <For each={cores()}>
          {(entry) => <CoreRow entry={entry} refresh={refresh} />}
        </For>
      </ul>
      <Show
        when={adding()}
        fallback={
          <button class={styles["core-add"]} onClick={() => setAdding(true)}>Core を追加</button>
        }
      >
        <form class={styles["core-add-form"]} onSubmit={submit}>
          <input
            value={url()}
            onInput={(event) => setUrl(event.currentTarget.value)}
            placeholder="http://127.0.0.1:7700"
          />
          <button type="submit">追加</button>
          <button type="button" onClick={() => setAdding(false)}>やめる</button>
        </form>
      </Show>
      <Show when={error()}><p class={styles["core-error"]}>{error()}</p></Show>
    </div>
  );
}

function CoreRow(props: { entry: CoreEntry; refresh: () => Promise<void> }): JSX.Element {
  const host = useShellHost();
  const href = useHref(() => `/${props.entry.key}/`);
  return (
    <li>
      <Show
        when={props.entry.key !== ""}
        fallback={
          <span class={styles["core-entry"]}>
            <span class={controlStyles["status-dot"]} data-status={props.entry.status === "connected" ? "connected" : "error"} />
            {props.entry.name || props.entry.url}
            <small>{statusText(props.entry)}</small>
          </span>
        }
      >
        <a class={styles["core-entry"]} href={href()}>
          <span class={controlStyles["status-dot"]} data-status={props.entry.status === "connected" ? "connected" : props.entry.status === "connecting" ? "connecting" : "error"} />
          {props.entry.name || props.entry.url}
          <small>{statusText(props.entry)}</small>
        </a>
        <Show when={props.entry.source !== "command"}>
          <ConfirmButton
            label="削除"
            confirmLabel="削除する？"
            confirm={async () => {
              await host.removeCore(props.entry.url);
              await props.refresh();
            }}
          >×</ConfirmButton>
        </Show>
      </Show>
    </li>
  );
}

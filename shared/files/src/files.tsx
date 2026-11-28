// file explorer Panelの本体。Pluginと同じく `mount(host, context)` で
// ShadowRootへ描く。Environment ProviderはheadlessでUIを持たないので、
// このPanelがfilesystem/listを宣言した登録をRegistryから探し、
// context.shell経由でcapabilityを呼ぶ。provider側にUIは置かない（Decision 00017）。
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import type { ViewContext, ViewHandle } from "@plugumi/view";

// shellから受け取る最小の口。AppControllerの型は引かず、
// このPanelが触るsliceだけを宣言する。
export interface FilesHost {
  coreKey(): string;
  host: {
    listRegistrations(key: string): Promise<RegistrationEntry[]>;
    invoke(key: string, body: { operation: string; input: unknown }): Promise<unknown>;
  };
}

// builtin panelはview channelを持たないので、contextのうちshellだけを使う。
export interface FilesPanelContext extends ViewContext {
  host: FilesHost;
  // file clickでeditorを開く口。shellが自分の居るAreaへ配線する。
  openPanelAcross?(providerId: string, panelId: string, input?: unknown): void;
}

interface RegistrationEntry {
  registrationId: string;
  providerId: string;
  rpcAvailable: boolean;
  operations: { path: string }[];
}

interface Entry {
  name: string;
  kind: string;
  size: number;
}

interface ListResult {
  entries?: Entry[];
}

export function mount(host: ShadowRoot, context: FilesPanelContext): ViewHandle {
  const saved = context.state as { path?: string } | undefined;
  const dispose = render(
    () => (
      <FilesPanel
        host={context.host}
        openPanelAcross={context.openPanelAcross}
        initialPath={typeof saved?.path === "string" ? saved.path : undefined}
        saveState={context.saveState}
      />
    ),
    host,
  );
  return { destroy: () => dispose() };
}

// filesystem/listを提供し、RPC接続が生きている登録を探す。
// operationにkindの概念はない — terminal応答するかはproviderの振る舞い。
function fsProviders(registrations: RegistrationEntry[]): RegistrationEntry[] {
  return registrations.filter((registration) =>
    registration.rpcAvailable &&
    registration.operations.some((operation) => operation.path === "filesystem/list"));
}

function FilesPanel(props: {
  host: FilesHost;
  openPanelAcross?: (providerId: string, panelId: string, input?: unknown) => void;
  initialPath?: string;
  saveState?: (state: unknown) => void;
}): JSX.Element {
  // providerは接続・切断しうるので3秒ごとに取り直す。中身が変わらなければ
  // 通知しない（shellのpollと同じ作法）。
  const [registrations, setRegistrations] = createSignal<RegistrationEntry[]>([], {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const [registrationsLoaded, setRegistrationsLoaded] = createSignal(false);
  const refresh = async () => {
    try {
      setRegistrations(await props.host.host.listRegistrations(props.host.coreKey()));
      setRegistrationsLoaded(true);
    } catch {
      // 巡回の失敗は握る — 次の巡回かTool呼び出しのerrorで分かる。
    }
  };
  queueMicrotask(() => void refresh());
  const timer = setInterval(refresh, 3000);
  onCleanup(() => clearInterval(timer));

  const providers = () => fsProviders(registrations());
  const [chosen, setChosen] = createSignal("");
  const provider = () =>
    providers().find((entry) => entry.registrationId === chosen()) ?? providers()[0];

  // 初期pathはrestorable stateから。directoryの移動はすべてchangePathを
  // 通るので、そこでsaveStateへ書けばreloadで同じ場所へ戻れる。
  const [path, setPath] = createSignal(props.initialPath ?? ".");
  const [draft, setDraft] = createSignal(props.initialPath ?? ".");
  const [listing, setListing] = createSignal<Entry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  createEffect(
    () => ({
      core: props.host.coreKey(),
      registrationId: provider()?.registrationId,
      directory: path(),
    }),
    ({ core, registrationId, directory }) => {
      if (!registrationId) {
        setListing([]);
        return;
      }
      let stale = false;
      setLoading(true);
      setError("");
      // registrationIdは解決に使わない — operationはpathだけで解決する。
      // providerを選ぶUIは残すが、それは「どの環境の一覧を見たいか」の
      // 表示上の選択で、呼び出しのroutingはCoreに委ねる。
      void registrationId;
      props.host.host.invoke(core, {
        operation: "filesystem/list", input: { path: directory },
      }).then((result) => {
        if (stale) return;
        setListing((result as ListResult).entries ?? []);
        setLoading(false);
      }).catch((cause) => {
        if (stale) return;
        setError(String(cause));
        setLoading(false);
      });
      onCleanup(() => {
        stale = true;
      });
    },
  );

  const changePath = (next: string) => {
    setPath(next);
    setDraft(next);
    props.saveState?.({ path: next });
  };

  const join = (name: string) => path() === "/" ? `/${name}` : `${path()}/${name}`;
  const open = (entry: Entry) => {
    if (entry.kind === "directory") {
      changePath(join(entry.name));
      return;
    }
    if (entry.kind === "file") {
      // editorはenvironment（filesystem provider）のpanel。同じpluginが
      // read/writeも受けるので、pathの解決はprovider内で一貫する。
      props.openPanelAcross?.("filesystem", "editor", { path: join(entry.name) });
    }
  };

  const up = () => {
    const current = path();
    if (current === "/" || current === ".") {
      changePath("..");
    } else if (current === ".." || current.endsWith("/..")) {
      changePath(`${current}/..`);
    } else {
      changePath(current.slice(0, current.lastIndexOf("/")) || "/");
    }
  };

  const go = () => {
    if (draft() !== "") changePath(draft());
  };

  return (
    <div class="files-panel">
      <Show when={providers().length === 0 && registrationsLoaded()}>
        <p class="files-empty">fs/listを提供するProviderが接続されていません</p>
      </Show>
      <Show when={providers().length > 1}>
        <select
          class="files-provider"
          value={provider()?.registrationId ?? ""}
          onChange={(event) => setChosen(event.currentTarget.value)}
        >
          <For each={providers()}>
            {(entry) => (
              <option value={entry.registrationId}>
                {entry.providerId} {entry.registrationId}
              </option>
            )}
          </For>
        </select>
      </Show>
      <form
        class="files-controls"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <input
          class="plugumi-input"
          type="text"
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <button class="plugumi-button" type="submit">移動</button>
        <button class="plugumi-button" type="button" onClick={up}>..</button>
      </form>
      <p class="files-path">{path()}</p>
      <Show when={error() !== ""}>
        <p class="files-error">{error()}</p>
      </Show>
      <Show when={loading()}>
        <p class="files-meta">読み込み中…</p>
      </Show>
      <ul class="plugumi-list files-list">
        <For each={listing()}>
          {(entry) => (
            <li>
              <Show
                when={entry.kind === "directory"}
                fallback={
                  <>
                    {/* fileもclickで開く — editorを起動するのはopen側 */}
                    <button
                      type="button"
                      class="plugumi-list-item files-entry"
                      onClick={() => open(entry)}
                    >
                      {entry.name}
                      <span class="plugumi-list-item-meta">{entry.kind} {entry.size}B</span>
                    </button>
                  </>
                }
              >
                <button
                  type="button"
                  class="plugumi-list-item files-entry files-directory"
                  onClick={() => open(entry)}
                >
                  {entry.name}/
                </button>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

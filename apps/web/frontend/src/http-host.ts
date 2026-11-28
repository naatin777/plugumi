// Host の HTTP 実装。plugumi-web の /api と /ui へ fetch する。
import type {
  CoreEntry, InvokeBody, PluginPanelEntry, ProjectTree, RegistrationEntry,
  Host, ViewTicket, WorkspaceState,
} from "@plugumi/app-ui";

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

const base = (key: string) => `/api/cores/${encodeURIComponent(key)}/projects`;

declare global {
  interface Window {
    // Electronのpreloadが注入する別window起動bridge。BrowserWindowを
    // 開ける宿主だけが置く。無ければブラウザのwindow.openに落とす。
    plugumiWindows?: { open(path: string): void };
  }
}

export function httpHost(): Host {
  return {
    async listCores(): Promise<CoreEntry[]> {
      const response = await fetch("/api/cores");
      if (!response.ok) throw new Error(`GET /api/cores: HTTP ${response.status}`);
      return (await response.json()) ?? [];
    },
    async getCore(key: string): Promise<CoreEntry> {
      const response = await fetch(`/api/cores/${encodeURIComponent(key)}`);
      if (!response.ok) throw new Error(`GET /api/cores/${key}: HTTP ${response.status}`);
      return response.json();
    },
    async addCore(url: string): Promise<void> {
      const response = await fetch("/api/cores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async removeCore(url: string): Promise<void> {
      const response = await fetch(`/api/cores?url=${encodeURIComponent(url)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async listPanels(key: string): Promise<PluginPanelEntry[]> {
      const response = await fetch(`/api/cores/${encodeURIComponent(key)}/panels`);
      if (!response.ok) throw new Error(`GET panels: HTTP ${response.status}`);
      // Coreが返すのはPlugin Panelだけ — kindを付けてdecodeする。
      const entries = ((await response.json()) ?? []) as Omit<PluginPanelEntry, "kind">[];
      return entries.map((entry) => ({ ...entry, kind: "plugin" as const }));
    },
    async listRegistrations(key: string): Promise<RegistrationEntry[]> {
      const response = await fetch(`/api/cores/${encodeURIComponent(key)}/registrations`);
      if (!response.ok) throw new Error(`GET registrations: HTTP ${response.status}`);
      return response.json();
    },
    async invoke(key: string, body: InvokeBody): Promise<unknown> {
      const response = await fetch(`/api/cores/${encodeURIComponent(key)}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      return (await response.json()).execution?.result;
    },
    async createView(key: string, body: { registrationId: string; panelId: string }): Promise<ViewTicket> {
      const response = await fetch(`/api/cores/${encodeURIComponent(key)}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      return response.json();
    },
    async closeView(key: string, viewId: string): Promise<void> {
      const response = await fetch(
        `/api/cores/${encodeURIComponent(key)}/views/${encodeURIComponent(viewId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async listProjects(key: string): Promise<ProjectTree[]> {
      const response = await fetch(base(key));
      if (!response.ok) throw new Error(`GET projects: HTTP ${response.status}`);
      // wireのareasは末端がnull（Goのnil slice）— host境界で[]へ正規化する。
      type WireArea = { key: string; title: string; areas: WireArea[] | null };
      const normalize = (area: WireArea): ProjectTree["areas"][number] => ({
        key: area.key, title: area.title, areas: (area.areas ?? []).map(normalize),
      });
      const trees = ((await response.json()) ?? []) as { key: string; title: string; areas: WireArea[] | null }[];
      return trees.map((tree) => ({ key: tree.key, title: tree.title, areas: (tree.areas ?? []).map(normalize) }));
    },
    async createProject(key: string, title: string): Promise<string> {
      const response = await fetch(base(key), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      return (await response.json()).key as string;
    },
    async createArea(key: string, project: string, parent: string[], title: string): Promise<string> {
      const response = await fetch(`${base(key)}/${project}/areas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent, title }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      return (await response.json()).key as string;
    },
    async deleteArea(key: string, project: string, areaPath: string[]): Promise<void> {
      const response = await fetch(
        `${base(key)}/${project}/areas?path=${encodeURIComponent(areaPath.join("/"))}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async getWorkspace(key: string, project: string, areaPath: string[]): Promise<unknown> {
      const response = await fetch(`${base(key)}/${project}/workspace?path=${encodeURIComponent(areaPath.join("/"))}`);
      if (!response.ok) throw new Error(`GET workspace: HTTP ${response.status}`);
      return response.json();
    },
    async putWorkspace(key: string, project: string, areaPath: string[], workspace: WorkspaceState): Promise<void> {
      const response = await fetch(`${base(key)}/${project}/workspace?path=${encodeURIComponent(areaPath.join("/"))}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workspace),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    uiURL(coreKey: string, registrationId: string, path: string, uiSha256: string): string {
      return `/ui/${encodeURIComponent(coreKey)}/${encodeURIComponent(registrationId)}` +
        `/${path}?v=${uiSha256}`;
    },
    // Areaを別windowに出す（detach）。Electronのpreload bridgeがある
    // 環境だけ有効にする（titleBarOverlay付きのBrowserWindowが開く）。
    // ブラウザでは項目自体を出さない（designs/00005「別windowはElectronのみ」）。
    windows: window.plugumiWindows ?? null,
  };
}

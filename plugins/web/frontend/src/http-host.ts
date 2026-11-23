// ShellHost の HTTP 実装。plugumi-web の /api と /ui へ fetch する。
import type {
  CallToolBody, CoreEntry, PanelEntry, ProjectTree,
  ShellHost, WorkspaceState,
} from "@plugumi/plugin-shell";

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

const base = (key: string) => `/api/cores/${encodeURIComponent(key)}/projects`;

export function httpShellHost(): ShellHost {
  return {
    async listCores(): Promise<CoreEntry[]> {
      const response = await fetch("/api/cores");
      if (!response.ok) throw new Error(`GET /api/cores: HTTP ${response.status}`);
      return response.json();
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
    async listPanels(key: string): Promise<PanelEntry[]> {
      const response = await fetch(`/api/cores/${encodeURIComponent(key)}/panels`);
      if (!response.ok) throw new Error(`GET panels: HTTP ${response.status}`);
      return response.json();
    },
    async callTool(key: string, body: CallToolBody): Promise<unknown> {
      const response = await fetch(`/api/cores/${encodeURIComponent(key)}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      return (await response.json()).result;
    },
    async listProjects(key: string): Promise<ProjectTree[]> {
      const response = await fetch(base(key));
      if (!response.ok) throw new Error(`GET projects: HTTP ${response.status}`);
      return response.json();
    },
    async createProject(key: string, name: string): Promise<void> {
      const response = await fetch(base(key), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async deleteProject(key: string, project: string): Promise<void> {
      const response = await fetch(`${base(key)}/${project}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async createArea(key: string, project: string, parent: string[], name: string): Promise<void> {
      const response = await fetch(`${base(key)}/${project}/areas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent, name }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async deleteArea(key: string, project: string, areaPath: string[]): Promise<void> {
      const response = await fetch(`${base(key)}/${project}/areas/${areaPath.join("/")}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    async getWorkspace(key: string, project: string, areaPath: string[]): Promise<unknown> {
      const response = await fetch(`${base(key)}/${project}/areas/${areaPath.join("/")}/workspace`);
      if (!response.ok) throw new Error(`GET workspace: HTTP ${response.status}`);
      return response.json();
    },
    async putWorkspace(key: string, project: string, areaPath: string[], workspace: WorkspaceState): Promise<void> {
      const response = await fetch(`${base(key)}/${project}/areas/${areaPath.join("/")}/workspace`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workspace),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
    },
    uiURL(coreKey: string, registrationId: string, path: string, uiSha256: string): string {
      return `/ui/${encodeURIComponent(coreKey)}/${encodeURIComponent(registrationId)}` +
        `/${path}?v=${uiSha256}`;
    },
  };
}

// E2Eハーネスのin-memory ShellHost。Core/Goサーバー・実データには触れない。
// Projects/Areas/workspaceはsessionStorageに保持する（reloadに耐え、
// タブを閉じれば消える）。
import type {
  CallToolBody, CoreEntry, PluginPanelEntry, ProjectTree,
  ShellHost, WorkspaceState,
} from "../../src/host.tsx";
import { pathKey } from "../../src/layout/area-list.ts";

const CORE: CoreEntry = {
  url: "memory://test", source: "saved", coreId: "test",
  name: "test", key: "test", status: "connected",
};

const PANELS: PluginPanelEntry[] = [
  {
    kind: "plugin", registrationId: "victim", pluginId: "victim",
    panelId: "panel", title: "Victim", entry: "panel.js",
    styles: ["panel.css"], uiSha256: "victim1",
  },
  {
    kind: "plugin", registrationId: "hostile", pluginId: "hostile",
    panelId: "panel", title: "Hostile", entry: "panel.js",
    styles: ["panel.css"], uiSha256: "hostile1",
  },
];

const STORE_KEY = "plugumi:e2e-host";

interface Stored {
  projects: ProjectTree[];
  workspaces: Record<string, unknown>;
}

const ref = (id: string, pluginId: string) =>
  ({ instanceId: id, pluginId, panelId: "panel" });
const themeRef = (id: string) =>
  ({ instanceId: id, pluginId: "shell", panelId: "theme" });

const empty = (): WorkspaceState => ({
  version: 1,
  left: { panels: [], selected: null },
  bottom: { panels: [], selected: null },
  right: { panels: [], selected: null },
  center: { focusedLeaf: "l1", root: { kind: "leaf", id: "l1", panels: [], selected: null } },
});

// seed=basic: Main/SubそれぞれにAreaがあり、center分割2leaf＋各dockに
// Panelが入っている状態。
const seeds: Record<string, () => Stored> = {
  basic: () => ({
    projects: [{ name: "demo", areas: [
      { name: "a1", areas: [] },
      { name: "a2", areas: [] },
    ] }],
    workspaces: {
      "demo/a1": {
        version: 1,
        left: { panels: [ref("pl", "victim")], selected: "pl" },
        bottom: { panels: [ref("pb", "victim")], selected: "pb" },
        right: { panels: [ref("pr", "victim")], selected: "pr" },
        center: {
          focusedLeaf: "l1",
          root: {
            kind: "split", id: "s1", axis: "x", ratio: 0.5,
            first: { kind: "leaf", id: "l1", panels: [themeRef("pt"), ref("pv", "victim")], selected: "pt" },
            second: { kind: "leaf", id: "l2", panels: [ref("pv2", "victim")], selected: "pv2" },
          },
        },
      },
      "demo/a2": {
        ...empty(),
        center: {
          focusedLeaf: "l1",
          root: { kind: "leaf", id: "l1", panels: [ref("ps", "victim")], selected: "ps" },
        },
      },
    },
  }),
};

export function createMemoryHost(): ShellHost {
  const seedName =
    new URLSearchParams(window.location.search).get("seed") ?? "basic";
  const stored: Stored = (() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw) as Stored;
    } catch { /* 書けなくてもmemoryだけで動く */ }
    return (seeds[seedName] ?? seeds.basic)();
  })();
  const save = () => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(stored)); }
    catch { /* 同上 */ }
  };
  // seedも一度書いておく — reload前にsessionStorageを直接参照する
  // テスト（css-isolationのworkspace書き換え）が空を踏まないように。
  save();

  const findProject = (name: string) =>
    stored.projects.find((project) => project.name === name);

  return {
    async listCores() { return [CORE]; },
    async getCore(key) {
      if (key !== CORE.key) throw new Error("core not found");
      return CORE;
    },
    async addCore() { throw new Error("not supported in test host"); },
    async removeCore() { throw new Error("not supported in test host"); },

    async listPanels() { return PANELS; },
    async callTool(_key: string, _body: CallToolBody) { return null; },

    async listProjects() { return stored.projects; },
    async createProject(_key, name) {
      if (findProject(name)) throw new Error("name already exists");
      stored.projects.push({ name, areas: [] });
      save();
    },
    async createArea(_key, project, parent, name) {
      const found = findProject(project);
      if (!found) throw new Error("project not found");
      let nodes = found.areas;
      for (const part of parent) {
        const next = nodes.find((area) => area.name === part);
        if (!next) throw new Error("parent not found");
        nodes = next.areas;
      }
      if (nodes.some((area) => area.name === name)) throw new Error("name already exists");
      nodes.push({ name, areas: [] });
      save();
    },
    async deleteArea(_key, project, areaPath) {
      const found = findProject(project);
      if (!found) throw new Error("project not found");
      let nodes = found.areas;
      for (const part of areaPath.slice(0, -1)) {
        const next = nodes.find((area) => area.name === part);
        if (!next) throw new Error("area not found");
        nodes = next.areas;
      }
      const name = areaPath[areaPath.length - 1];
      const index = nodes.findIndex((area) => area.name === name);
      if (index < 0) throw new Error("area not found");
      nodes.splice(index, 1);
      save();
    },

    async getWorkspace(_key, project, areaPath) {
      return stored.workspaces[`${project}/${pathKey(areaPath)}`] ?? null;
    },
    async putWorkspace(_key, project, areaPath, workspace) {
      stored.workspaces[`${project}/${pathKey(areaPath)}`] = workspace;
      save();
    },

    uiURL(_coreKey, registrationId, path, uiSha256) {
      return `/fixtures/${encodeURIComponent(registrationId)}/${path}?v=${uiSha256}`;
    },
    windows: null,
  };
}

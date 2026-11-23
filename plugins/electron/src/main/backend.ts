// rendererのpreload IPCとplugumi-ui://の後ろ側。
// web pluginのserverパッケージが/apiと/uiで提供する操作に相当する。
import { CoreHttpError, CoreManager, normalizeURL } from "./cores.js";
import type { CoreEntry, CoreSource, RegistrySnapshot } from "./cores.js";
import type { CoreStore } from "./core-store.js";
import { RpcPool } from "./rpc.js";
import * as projects from "./projects.js";

export interface CallToolBody {
  registrationId: string;
  toolPath: string;
  input: unknown;
}

// Backend はShellHostの各メソッド（uiURL以外）とUI assetの取得を担う。
export class Backend {
  private readonly calls: RpcPool;
  private readonly documents = new Map<string, projects.Document>();

  constructor(
    private readonly manager: CoreManager,
    private readonly store: CoreStore | undefined,
    private readonly electronDir: string,
    token: string | undefined,
  ) {
    this.calls = new RpcPool(token);
  }

  listCores(): CoreEntry[] {
    return this.manager.list();
  }

  getCore(key: string): CoreEntry {
    const core = this.coreByKey(key);
    return core;
  }

  // addCore はUIからのCore追加。事前に/v1/coreを取り、name必須・
  // 同名の別URLとの衝突を検査してからsavedで登録する。
  async addCore(url: string): Promise<CoreEntry> {
    const normalized = normalizeURL(url);
    if (this.manager.get(normalized)) {
      throw new Error(`Core at ${normalized} is already registered`);
    }
    let info;
    try {
      info = await this.manager.fetchCoreInfo(normalized);
    } catch (error) {
      if (error instanceof CoreHttpError) {
        throw new Error(`Core at ${normalized} returned ${error.message}`);
      }
      throw new Error(`Core at ${normalized} is unreachable: ${error}`);
    }
    if (!info.name) {
      throw new Error("core.name を設定してください");
    }
    const conflict = this.manager.nameTaken(info.name, normalized);
    if (conflict) {
      throw new Error(`Core name ${JSON.stringify(info.name)} is already used by ${conflict.url}`);
    }
    this.manager.add(normalized, "saved");
    this.manager.setInfo(normalized, info);
    if (this.store) {
      try {
        this.store.add(normalized);
      } catch (error) {
        await this.manager.remove(normalized);
        throw new Error(`could not save Core list: ${error}`);
      }
    }
    return this.manager.get(normalized)!;
  }

  async removeCore(url: string): Promise<void> {
    const normalized = normalizeURL(url);
    const core = this.manager.get(normalized);
    if (!core) throw new Error("no such Core");
    if (core.source !== "saved") {
      throw new Error("Cores passed on the command line cannot be removed");
    }
    await this.manager.remove(normalized);
    if (this.store) {
      try {
        this.store.remove(normalized);
      } catch (error) {
        throw new Error(`could not save Core list: ${error}`);
      }
    }
  }

  async listPanels(key: string) {
    const core = this.coreByKey(key);
    const snapshot = await this.fetchRegistry(core);
    return snapshot.registrations.flatMap((registration) =>
      (registration.panels ?? []).map((panel) => ({
        registrationId: registration.registrationId,
        pluginId: registration.pluginId,
        panelId: panel.panelId,
        title: panel.title,
        entry: panel.entry,
        styles: panel.styles ?? [],
        uiSha256: registration.uiSha256 ?? "",
      })),
    );
  }

  // callTool はtools.callへ中継する。今回はsync Toolのみ。asyncは実処理が
  // 走ったまま終端を取りこぼすため事前に止める（web pluginと同じ扱い）。
  async callTool(key: string, body: CallToolBody): Promise<unknown> {
    const core = this.coreByKey(key);
    if (!body.registrationId || !body.toolPath) {
      throw new Error("request must have registrationId, toolPath and input");
    }
    const snapshot = await this.fetchRegistry(core);
    for (const registration of snapshot.registrations) {
      if (registration.registrationId !== body.registrationId) continue;
      for (const tool of registration.tools) {
        if (tool.toolPath === body.toolPath && tool.kind === "async") {
          throw new Error("async Tools are not supported yet");
        }
      }
    }
    return this.calls.for(core.url).call(body.registrationId, body.toolPath, body.input);
  }

  // uiAsset はplugumi-ui://<key>/<registrationId>/<path>?v=<sha>を
  // CoreのGET /v1/uiへ中継する（web pluginのGET /ui/と同じ役割）。
  async uiAsset(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.slice(1).split("/");
    const registrationId = segments.shift();
    const path = segments.join("/");
    const core = this.manager.findByKey(decodeURIComponent(url.host));
    if (!core || !registrationId || !path) {
      return new Response("not found", { status: 404 });
    }
    const upstream = `${core.url}/v1/ui/${encodeURIComponent(registrationId)}/${path}`;
    const headers: Record<string, string> = {};
    const token = this.manager.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetch(upstream, { headers });
      const passthrough: Record<string, string> = {};
      for (const name of ["content-type", "etag"]) {
        const value = response.headers.get(name);
        if (value) passthrough[name] = value;
      }
      // file://のrendererからのfetch・動的importはCORS検査を通る必要がある
      // （opaque originなので*のみ有効）。
      passthrough["access-control-allow-origin"] = "*";
      return new Response(response.body, { status: response.status, headers: passthrough });
    } catch {
      return new Response(`Core at ${core.url} is unreachable`, { status: 502 });
    }
  }

  // ---- Project/Area/Workspace（~/.plugumi/electron/<Core名>.json） ----

  listProjects(key: string) {
    return projects.trees(this.document(key));
  }

  createProject(key: string, name: string): void {
    this.mutate(key, (document) => projects.addProject(document, name));
  }

  deleteProject(key: string, project: string): void {
    this.mutate(key, (document) => {
      if (!projects.removeProject(document, project)) {
        throw new Error("project not found");
      }
    });
  }

  createArea(key: string, projectName: string, parent: string[], name: string): void {
    this.mutateProject(key, projectName, (project) => projects.addArea(project, parent, name));
  }

  deleteArea(key: string, projectName: string, areaPath: string[]): void {
    this.mutateProject(key, projectName, (project) => {
      if (!projects.removeArea(project, areaPath)) {
        throw new Error("area not found");
      }
    });
  }

  getPinned(key: string, projectName: string): projects.Opaque {
    const project = this.projectByName(key, projectName);
    return project.pinned;
  }

  putPinned(key: string, projectName: string, pinned: projects.Opaque): void {
    projects.validateOpaque(pinned);
    this.mutateProject(key, projectName, (project) => {
      project.pinned = pinned;
    });
  }

  getWorkspace(key: string, projectName: string, areaPath: string[]): projects.Opaque {
    return this.areaByPath(key, projectName, areaPath).workspace;
  }

  putWorkspace(key: string, projectName: string, areaPath: string[], workspace: projects.Opaque): void {
    projects.validateOpaque(workspace);
    this.mutateProject(key, projectName, (project) => {
      const area = projects.findArea(project, areaPath);
      if (!area) throw new Error("area not found");
      area.workspace = workspace;
    });
  }

  // ---- 内部 ----

  private coreByKey(key: string): CoreEntry {
    const core = this.manager.findByKey(key);
    if (!core) throw new Error("no such Core");
    return core;
  }

  private async fetchRegistry(core: CoreEntry): Promise<RegistrySnapshot> {
    try {
      return await this.manager.fetchRegistry(core.url);
    } catch (error) {
      throw new Error(`could not read Core registry: ${error}`);
    }
  }

  // document はcore.nameを保存ファイル名に使う。nameの無いCoreでは
  // 保存先が決まらないためエラーにする（web pluginの409と同じ扱い）。
  private document(key: string): projects.Document {
    const core = this.coreByKey(key);
    if (!core.name) throw new Error("core.name を設定してください");
    let document = this.documents.get(core.name);
    if (!document) {
      document = projects.load(this.electronDir, core.name);
      this.documents.set(core.name, document);
    }
    return document;
  }

  private persist(key: string): void {
    const core = this.coreByKey(key);
    const document = this.documents.get(core.name);
    if (document) projects.save(this.electronDir, core.name, document);
  }

  private mutate(key: string, change: (document: projects.Document) => void): void {
    const document = this.document(key);
    change(document);
    this.persist(key);
  }

  private projectByName(key: string, projectName: string): projects.Project {
    const project = projects.findProject(this.document(key), projectName);
    if (!project) throw new Error("project not found");
    return project;
  }

  private mutateProject(key: string, projectName: string, change: (project: projects.Project) => void): void {
    change(this.projectByName(key, projectName));
    this.persist(key);
  }

  private areaByPath(key: string, projectName: string, areaPath: string[]): projects.Area {
    const area = projects.findArea(this.projectByName(key, projectName), areaPath);
    if (!area) throw new Error("area not found");
    return area;
  }

  close(): Promise<void> {
    return this.manager.close();
  }
}

// 起動時のCore登録。正規化できないURL・重複はエラー。command側を優先する。
export function seedCores(
  manager: CoreManager, store: CoreStore | undefined, commandURLs: string[],
): void {
  const seen = new Set<string>();
  const add = (raw: string, source: CoreSource) => {
    const normalized = normalizeURL(raw);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    manager.add(normalized, source);
  };
  for (const url of commandURLs) add(url, "command");
  if (store) {
    for (const url of store.load()) add(url, "saved");
  }
}

// CoreごとのProject/Area/Workspaceの木構造と保存。
// web pluginのprojectsパッケージと同じ保存形式（~/.plugumi/electron/<Core名>.json）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PanelRef {
  instanceId: string;
  pluginId: string;
  panelId: string;
}

export interface Dock {
  panels: PanelRef[];
  selected: string;
}

export interface Workspace {
  left: Dock;
  center: Dock;
  right: Dock;
  bottom: Dock;
}

export interface Area {
  name: string;
  workspace: Workspace;
  areas: Area[];
}

export interface Project {
  name: string;
  pinned: Dock;
  areas: Area[];
}

export interface Document {
  projects: Project[];
}

// GET /api/cores/{key}/projectsが返す名前だけの木。
export interface AreaTree {
  name: string;
  areas: AreaTree[];
}

export interface ProjectTree {
  name: string;
  areas: AreaTree[];
}

export class InvalidNameError extends Error {}
export class DuplicateNameError extends Error {}
export class AreaNotFoundError extends Error {}
export class InvalidDockError extends Error {}

// core.nameと同じ形式。名前がそのままURLの識別子になるため。
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validName(name: string): boolean {
  return name.length >= 1 && name.length <= 63 && NAME_PATTERN.test(name);
}

const emptyDock = (): Dock => ({ panels: [], selected: "" });
const emptyWorkspace = (): Workspace => ({
  left: emptyDock(), center: emptyDock(), right: emptyDock(), bottom: emptyDock(),
});

export function load(directory: string, coreName: string): Document {
  let data: string;
  try {
    data = readFileSync(join(directory, `${coreName}.json`), "utf8");
  } catch {
    return { projects: [] };
  }
  return JSON.parse(data) as Document;
}

// save は一時ファイルへ書いてからrenameで置き換える。ディレクトリは0700、
// ファイルは0600。
export function save(directory: string, coreName: string, document: Document): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.tmp-${process.pid}-${Date.now()}.json`);
  writeFileSync(temporary, JSON.stringify(document, null, "  "), { mode: 0o600 });
  renameSync(temporary, join(directory, `${coreName}.json`));
}

export function trees(document: Document): ProjectTree[] {
  return document.projects.map((project) => ({
    name: project.name,
    areas: areaTrees(project.areas),
  }));
}

function areaTrees(areas: Area[]): AreaTree[] {
  return areas.map((area) => ({ name: area.name, areas: areaTrees(area.areas) }));
}

export function findProject(document: Document, name: string): Project | undefined {
  return document.projects.find((project) => project.name === name);
}

export function addProject(document: Document, name: string): void {
  if (!validName(name)) throw new InvalidNameError("invalid name");
  if (findProject(document, name)) throw new DuplicateNameError("name already exists");
  document.projects.push({ name, pinned: emptyDock(), areas: [] });
}

export function removeProject(document: Document, name: string): boolean {
  const index = document.projects.findIndex((project) => project.name === name);
  if (index < 0) return false;
  document.projects.splice(index, 1);
  return true;
}

// findArea はpath（親からの名前列。空=直下不可）でAreaを指す。
export function findArea(project: Project, path: string[]): Area | undefined {
  let areas = project.areas;
  let found: Area | undefined;
  for (const name of path) {
    found = areas.find((area) => area.name === name);
    if (!found) return undefined;
    areas = found.areas;
  }
  return found;
}

export function addArea(project: Project, parent: string[], name: string): void {
  if (!validName(name)) throw new InvalidNameError("invalid name");
  let siblings: Area[];
  if (parent.length === 0) {
    siblings = project.areas;
  } else {
    const owner = findArea(project, parent);
    if (!owner) throw new AreaNotFoundError("parent area not found");
    siblings = owner.areas;
  }
  if (siblings.some((area) => area.name === name)) {
    throw new DuplicateNameError("name already exists");
  }
  siblings.push({ name, workspace: emptyWorkspace(), areas: [] });
}

// removeArea はpathのAreaを子ごと削除する。
export function removeArea(project: Project, path: string[]): boolean {
  if (path.length === 0) return false;
  const siblings = path.length > 1
    ? findArea(project, path.slice(0, -1))?.areas
    : project.areas;
  if (!siblings) return false;
  const index = siblings.findIndex((area) => area.name === path[path.length - 1]);
  if (index < 0) return false;
  siblings.splice(index, 1);
  return true;
}

// validateDock はPUTの検証。instanceIdは"panel-"始まり、
// selectedは空かpanels内のinstanceId。
export function validateDock(dock: Dock): void {
  for (const panel of dock.panels) {
    if (!panel.instanceId.startsWith("panel-")) {
      throw new InvalidDockError("invalid dock layout");
    }
  }
  if (dock.selected !== "" && !dock.panels.some((panel) => panel.instanceId === dock.selected)) {
    throw new InvalidDockError("invalid dock layout");
  }
}

export function validateWorkspace(workspace: Workspace): void {
  for (const dock of [workspace.left, workspace.center, workspace.right, workspace.bottom]) {
    if (!dock) throw new InvalidDockError("workspace must contain left/center/right/bottom docks");
    validateDock(dock);
  }
}

// CoreごとのProject/Area/Workspaceの木構造と保存。
// web pluginのprojectsパッケージと同じ保存形式（~/.plugumi/electron/<Core名>.json）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// WorkspaceとPinnedはShellが所有するJSON（designs/00005「保存の形」）。
// mainは中身を解釈せずそのまま保存・返却する。型はunknownで運び、
// PUTの入力だけJSON objectかnullに絞る（isOpaque）。
export type Opaque = unknown;

export interface Area {
  name: string;
  workspace: Opaque;
  areas: Area[];
}

export interface Project {
  name: string;
  pinned: Opaque;
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
export class InvalidOpaqueError extends Error {}

// core.nameと同じ形式。名前がそのままURLの識別子になるため。
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validName(name: string): boolean {
  return name.length >= 1 && name.length <= 63 && NAME_PATTERN.test(name);
}

// 未保存はnull。object（Shellのstate）かnullだけを受け付ける。
export function isOpaque(value: unknown): boolean {
  return value === null || (typeof value === "object" && !Array.isArray(value));
}

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
  document.projects.push({ name, pinned: null, areas: [] });
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
  siblings.push({ name, workspace: null, areas: [] });
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

// validateOpaque はPUTの検証。objectかnullだけを受け付ける。
export function validateOpaque(value: unknown): void {
  if (!isOpaque(value)) throw new InvalidOpaqueError("body must be an object or null");
}

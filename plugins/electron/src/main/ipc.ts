// rendererからの呼び出しをBackendへ振り分ける。ShellHostのメソッド名を
// そのまま使う（uiURLはrenderer側で組み立てるので対象外）。
import { ipcMain } from "electron";
import type { Backend } from "./backend.js";
import type { CallToolBody } from "./backend.js";


const CHANNEL = "shell";

export function registerIpc(backend: Backend): void {
  ipcMain.handle(CHANNEL, async (_event, method: unknown, args: unknown) => {
    const values = Array.isArray(args) ? args : [];
    switch (method) {
      case "listCores":
        return backend.listCores();
      case "getCore":
        return backend.getCore(values[0] as string);
      case "addCore":
        return backend.addCore(values[0] as string);
      case "removeCore":
        return backend.removeCore(values[0] as string);
      case "listPanels":
        return backend.listPanels(values[0] as string);
      case "callTool":
        return backend.callTool(values[0] as string, values[1] as CallToolBody);
      case "listProjects":
        return backend.listProjects(values[0] as string);
      case "createProject":
        return backend.createProject(values[0] as string, values[1] as string);
      case "deleteProject":
        return backend.deleteProject(values[0] as string, values[1] as string);
      case "createArea":
        return backend.createArea(
          values[0] as string, values[1] as string, values[2] as string[], values[3] as string,
        );
      case "deleteArea":
        return backend.deleteArea(values[0] as string, values[1] as string, values[2] as string[]);
      case "getPinned":
        return backend.getPinned(values[0] as string, values[1] as string);
      case "putPinned":
        return backend.putPinned(values[0] as string, values[1] as string, values[2]);
      case "getWorkspace":
        return backend.getWorkspace(values[0] as string, values[1] as string, values[2] as string[]);
      case "putWorkspace":
        return backend.putWorkspace(
          values[0] as string, values[1] as string, values[2] as string[],
          values[3],
        );
      default:
        throw new Error(`unknown method: ${String(method)}`);
    }
  });
}

// 接続先Core一覧と、各Coreへの登録・Lease更新を管理する。
// web pluginのcoresパッケージと同じ意味（contracts/00004のPlugin側登録処理）。
import { randomUUID } from "node:crypto";

export type CoreSource = "command" | "saved";
export type CoreStatus = "connecting" | "connected" | "rejected" | "unreachable";

export interface CoreEntry {
  url: string;
  source: CoreSource;
  coreId: string;
  name: string;
  key: string;
  status: CoreStatus;
  error?: string;
}

interface CoreInfo {
  coreId: string;
  name?: string;
}

interface RegistrationLease {
  registrationId: string;
  leaseSeconds: number;
}

export class CoreHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const INVALID_URL = "Core URL must be an http://<host>:<port> URL";

// normalizeURL はCoreの待受URLをhttp://host:portの形に正規化する。
// 画面の制御で外部へ出ないようloopbackに限定する（Go側と同じ条件）。
export function normalizeURL(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(INVALID_URL);
  }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search || parsed.hash || !parsed.port) {
    throw new Error(INVALID_URL);
  }
  const hostname = parsed.hostname;
  // URL hostnameはIPv6を[::1]の形で返す。loopback判定は127.0.0.0/8と::1。
  if (hostname !== "localhost" && !hostname.startsWith("127.") && hostname !== "[::1]") {
    throw new Error(`Core URL must be a loopback address (got ${raw})`);
  }
  return `http://${parsed.host}`;
}

// Manager は全Coreへの接続を管理する。
export class CoreManager {
  private readonly cores = new Map<string, TrackedCore>();

  constructor(
    readonly pluginInstanceId: string,
    readonly token: string | undefined,
  ) {}

  add(url: string, source: CoreSource): void {
    if (this.cores.has(url)) {
      throw new Error(`Core at ${url} is already registered`);
    }
    const tracked = new TrackedCore(url, source, this);
    this.cores.set(url, tracked);
    void tracked.run();
  }

  setInfo(url: string, info: CoreInfo): void {
    this.cores.get(url)?.setState("connecting", info.coreId, info.name ?? "", "");
  }

  async remove(url: string): Promise<void> {
    const tracked = this.cores.get(url);
    this.cores.delete(url);
    if (!tracked) return;
    tracked.stop();
    await tracked.done;
  }

  async close(): Promise<void> {
    const tracked = [...this.cores.values()];
    this.cores.clear();
    for (const core of tracked) core.stop();
    await Promise.all(tracked.map((core) => core.done));
  }

  get(url: string): CoreEntry | undefined {
    return this.cores.get(url)?.snapshot();
  }

  findByKey(key: string): CoreEntry | undefined {
    return this.list().find((core) => core.key !== "" && core.key === key);
  }

  list(): CoreEntry[] {
    return [...this.cores.values()]
      .map((core) => core.snapshot())
      .sort((first, second) => first.url.localeCompare(second.url));
  }

  nameTaken(name: string, excludeURL: string): CoreEntry | undefined {
    return this.list().find(
      (core) => core.url !== excludeURL && core.name !== "" && core.name === name,
    );
  }

  // ---- Core REST（web pluginのcoreclientに相当） ----

  async request(method: string, url: string, path: string, body?: object, timeoutMs = 5000): Promise<Response> {
    const response = await fetch(url + "/v1" + path, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreHttpError(response.status, `${method} ${path}: HTTP ${response.status}`);
    }
    return response;
  }

  async fetchCoreInfo(url: string, timeoutMs = 5000): Promise<CoreInfo> {
    const response = await this.request("GET", url, "/core", undefined, timeoutMs);
    return (await response.json()) as CoreInfo;
  }

  async fetchRegistry(url: string): Promise<RegistrySnapshot> {
    const response = await this.request("GET", url, "/registry");
    return (await response.json()) as RegistrySnapshot;
  }
}

export interface PanelDeclaration {
  panelId: string;
  title: string;
  entry: string;
  styles?: string[];
}

interface ToolDeclaration {
  toolPath: string;
  kind?: string;
}

interface RegistryRegistration {
  registrationId: string;
  pluginId: string;
  rpcAvailable: boolean;
  tools: ToolDeclaration[];
  panels?: PanelDeclaration[];
  uiSha256?: string;
}

export interface RegistrySnapshot {
  registrations: RegistryRegistration[];
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    const aborted = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      aborted();
      return;
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

// TrackedCore は1つのCoreへの接続状態。登録・Lease更新の繰り返しと
// 指数backoffによる再接続を行う。401/403/426は再試行しない（rejected）。
class TrackedCore {
  coreId = "";
  name = "";
  status: CoreStatus = "connecting";
  error = "";
  registrationId = "";
  readonly done: Promise<void>;

  private readonly abort = new AbortController();
  private resolveDone!: () => void;

  constructor(
    readonly url: string,
    readonly source: CoreSource,
    private readonly manager: CoreManager,
  ) {
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  snapshot(): CoreEntry {
    // keyはhash routingのパスに使う識別子。webは/api,/assets,/uiとの衝突を
    // 避けるため予約名を空にするが、electronのrouteは#配下なので衝突しない。
    return {
      url: this.url, source: this.source, coreId: this.coreId, name: this.name,
      key: this.name || this.coreId, status: this.status,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  setState(status: CoreStatus, coreId: string, name: string, error: string): void {
    if (coreId !== "") this.coreId = coreId;
    if (name !== "" || status === "connected") this.name = name;
    this.status = status;
    this.error = error;
  }

  stop(): void {
    this.abort.abort();
  }

  async run(): Promise<void> {
    try {
      let backoff = 250;
      while (!this.abort.signal.aborted) {
        try {
          await this.session(() => {
            backoff = 250;
          });
          break;
        } catch (error) {
          if (this.abort.signal.aborted) break;
          if (error instanceof CoreHttpError && [401, 403, 426].includes(error.status)) {
            this.setState("rejected", "", "", error.message);
            return;
          }
          this.setState("unreachable", "", "", String(error));
        }
        try {
          await delay(backoff + Math.random() * backoff / 4, this.abort.signal);
        } catch {
          break;
        }
        backoff = Math.min(backoff * 2, 5000);
      }
    } finally {
      // 終了時は登録を削除する（lease放置でCore側が消すより速く確実）。
      const registrationId = this.registrationId;
      if (registrationId) {
        await this.manager.request(
          "DELETE", this.url, `/registrations/${encodeURIComponent(registrationId)}`,
          undefined, 1500,
        ).catch(() => {});
      }
      this.resolveDone();
    }
  }

  // session は登録からLease更新までの1区間。登録を失ったら戻って再登録する。
  private async session(connected: () => void): Promise<void> {
    const registration = await this.manager.request("POST", this.url, "/registrations", {
      pluginId: "electron",
      pluginInstanceId: this.manager.pluginInstanceId,
    });
    const lease = (await registration.json()) as RegistrationLease;
    this.registrationId = lease.registrationId;
    const info = await this.manager.fetchCoreInfo(this.url);
    // Core再起動でcoreIdは変わるので、登録のたびに取り直して保持する。
    this.setState("connected", info.coreId, info.name ?? "", "");
    connected();
    const path = `/registrations/${encodeURIComponent(lease.registrationId)}`;
    let leaseSeconds = lease.leaseSeconds;
    while (!this.abort.signal.aborted) {
      const interval = Math.max(leaseSeconds * 500, 1000);
      await delay(interval, this.abort.signal);
      const renewed = await this.manager.request("POST", this.url, `${path}/renew`);
      leaseSeconds = ((await renewed.json()) as RegistrationLease).leaseSeconds;
    }
  }
}

export function newInstanceId(): string {
  return `plugin-${randomUUID()}`;
}

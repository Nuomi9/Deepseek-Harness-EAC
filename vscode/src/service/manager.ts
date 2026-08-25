// src/service/manager.ts — 服务管理器：状态机编排探测/插件同步/启动/等待/停止
// 纯模块：不依赖 vscode；探测、spawn、插件同步均通过依赖注入，便于单测。
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { findFreePort, PORT_FALLBACK_ATTEMPTS, type ProbeResult } from './detect';
import {
  startDsh,
  waitForReadyLine,
  stopChildTree,
  bundledNodeExe,
  bundledDshBin,
  type ChildProcessLike,
  type SpawnFn,
} from './process';
import type { MsgKey } from '../i18n';

/** 服务状态 */
export type ServiceState = 'idle' | 'detecting' | 'starting' | 'ready' | 'failed' | 'stopping';

/** 对外发布的状态快照（不可变副本） */
export interface ServiceSnapshot {
  state: ServiceState;
  /** 就绪后的网页地址（http://host:port/） */
  url: string | null;
  /** 失败原因（i18n 键，由面板/状态栏负责翻译） */
  error: MsgKey | null;
  /** 错误文案的 {变量} 值 */
  errorVars?: Record<string, string | number>;
  /** 当前就绪的服务是否由插件启动（决定 stop 时是否可杀） */
  owned: boolean;
  /** 实际使用的端口（配置 0 时由稳定端口选择器决定） */
  port: number;
}

/** 管理器配置 */
export interface ManagerOptions {
  host: string;
  /** 期望端口（0 = 自动选择稳定端口，复用仓库 stable-port.js 逻辑） */
  port: number;
  autoStart: boolean;
  stopOnExit: boolean;
  /** dsh profile（web-desktop | web） */
  profile: string;
  /** DSH_HOME（空串 = 默认 ~/.dsh-v4lite） */
  dshHome: string;
  extraArgs: string[];
  patchOverlays: string[];
  openInBrowser: boolean;
  /** 仓库根目录（desktop-core.js / assets / node_modules / vendor 所在） */
  repoRoot: string;
  /** 用户数据目录（%APPDATA%/Deepseek Harness EAC v4Lite，settings.json 所在） */
  userDataDir: string;
  /** 日志目录（userData/logs） */
  logsDir: string;
  /** 子进程工作目录（兜底：以 VS Code 工作区为 cwd） */
  cwd?: string;
  /** 启动前是否同步内置插件/皮肤（万物皆插件） */
  syncBuiltinPlugins: boolean;
  /** 等待就绪总超时（毫秒，默认 15000） */
  startTimeoutMs: number;
  /** 首次引导（profile 无 node_modules）放宽后的超时（毫秒，默认 300000） */
  firstBootTimeoutMs: number;
  /** 就绪后健康探测间隔（毫秒，默认 30000；≤0 关闭） */
  healthIntervalMs: number;
}

/** desktop-core 的最小接口（插件同步/端口持久化/目录解析所需子集） */
export interface DesktopCoreApi {
  syncAll(): { ok: boolean; message?: string };
  loadSettings(): Record<string, unknown>;
  saveSettings(s: Record<string, unknown>): void;
  desktopProfile(): string;
  desktopProfileDir(): string;
  ensureDesktopProfileInit(): void;
  /** 内置插件清单长度（同步注册条目数，用于提示） */
  companionPluginsCount?: number;
}

/** 注入依赖 */
export interface ManagerDeps {
  probeService: (host: string, port: number, timeoutMs?: number) => Promise<ProbeResult>;
  spawnImpl: SpawnFn;
  /** 日志出口（扩展里接到 Output Channel） */
  log: (line: string) => void;
  /** 插件生态编排（desktop-core 实例）；未提供时跳过同步/稳定端口 */
  core: DesktopCoreApi | null;
  /** 端口被占用时自动临时替换成功后的通知回调 */
  onPortFallback?: (requestedPort: number, fallbackPort: number) => void;
  /** 内置插件同步完成后的回调（count = 注册条目数） */
  onSyncDone?: (count: number) => void;
  /** 就绪端口变化回调（用于通知实际端口） */
  onReady?: (port: number, url: string) => void;
}

/** 默认超时（毫秒） */
const DEFAULT_START_TIMEOUT_MS = 15000;
/** 首次引导（profile 首次安装依赖）的超时（毫秒） */
const DEFAULT_FIRST_BOOT_TIMEOUT_MS = 300000;
/** 就绪后健康探测间隔默认值（毫秒） */
const DEFAULT_HEALTH_INTERVAL_MS = 30000;

export { DEFAULT_START_TIMEOUT_MS, DEFAULT_FIRST_BOOT_TIMEOUT_MS, DEFAULT_HEALTH_INTERVAL_MS };

/** 默认 DSH_HOME（与桌面版一致，与原版 ~/.dsh 隔离） */
export function defaultDshHome(): string {
  return join(homedir(), '.dsh-v4lite');
}

/**
 * 解析稳定端口：配置 0 时复用 settings.webPort（若已被 DSH 占用则复用该实例）。
 * @returns { port, isReuse } — isReuse=true 表示该端口已有 DSH 服务在跑
 */
export async function resolvePort(
  opts: ManagerOptions,
  deps: ManagerDeps,
  existingUrl: string | null,
): Promise<{ port: number; reuse: boolean }> {
  // 用户显式指定端口：直接使用（探测到已有 DSH 则复用）
  if (opts.port > 0) {
    return { port: opts.port, reuse: existingUrl !== null };
  }
  // 自动模式：优先复用 settings.webPort；已被 DSH 占用则复用实例，否则挑空闲端口
  const preferred = Number(deps.core?.loadSettings()?.webPort ?? 0) || 0;
  if (preferred > 0) {
    const probe = await deps.probeService(opts.host, preferred, 3000);
    if (probe === 'dsh') return { port: preferred, reuse: true };
  }
  if (!deps.core) return { port: preferred > 0 ? preferred : 0, reuse: false };
  // 复用仓库根 stable-port.js：挑稳定空闲端口并持久化到 settings
  const stablePort = eval('require')(
    join(opts.repoRoot, 'stable-port.js'),
  ) as {
    chooseStableWebPort(ctx: {
      loadSettings(): Record<string, unknown>;
      saveSettings(_ctx: unknown, s: Record<string, unknown>): void;
    }): Promise<number>;
  };
  const ctx = {
    loadSettings: () => deps.core!.loadSettings(),
    saveSettings: (_c: unknown, s: Record<string, unknown>) => deps.core!.saveSettings(s),
  };
  const port = await stablePort.chooseStableWebPort(ctx);
  return { port, reuse: false };
}

export class ServiceManager {
  private snapshot: ServiceSnapshot = {
    state: 'idle',
    url: null,
    error: null,
    owned: false,
    port: 0,
  };
  private listeners = new Set<(s: ServiceSnapshot) => void>();
  private op: Promise<ServiceSnapshot> | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private stopRequested = false;
  private child: ChildProcessLike | null = null;
  private disposed = false;
  private parentExitHook = (): void => {
    try {
      this.child?.kill('SIGKILL');
    } catch {
      /* 进程可能已退出，忽略 */
    }
  };

  constructor(
    private opts: ManagerOptions,
    private deps: ManagerDeps,
  ) {
    // 字段初始化器不能引用构造参数属性（TS2729），此处补上实际端口
    this.snapshot = { ...this.snapshot, port: opts.port };
    process.once('exit', this.parentExitHook);
  }

  getSnapshot(): ServiceSnapshot {
    return { ...this.snapshot };
  }

  getTarget(): { host: string; port: number } {
    return { host: this.opts.host, port: this.snapshot.port || this.opts.port };
  }

  /** 更新配置（服务相关设置变更时调用；下次 restart 生效） */
  updateOptions(opts: ManagerOptions): void {
    this.opts = { ...this.opts, ...opts };
  }

  onChange(cb: (s: ServiceSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(partial: Partial<ServiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const cb of this.listeners) cb(this.getSnapshot());
  }

  private url(port: number): string {
    return `http://${this.opts.host}:${port}/`;
  }

  /** 确保服务就绪：复用已有 / 自动启动（幂等：并发调用共享同一次流程） */
  ensureRunning(): Promise<ServiceSnapshot> {
    if (this.op) return this.op;
    if (this.snapshot.state === 'ready') return Promise.resolve(this.getSnapshot());
    this.stopRequested = false;
    this.op = this.doStart().finally(() => {
      this.op = null;
    });
    return this.op;
  }

  /** 重启：停掉自己启动的服务后重新走启动流程 */
  restart(): Promise<ServiceSnapshot> {
    if (this.op) return this.op;
    this.stopRequested = false;
    this.op = (async () => {
      await this.stopOwned();
      return this.doStart();
    })().finally(() => {
      this.op = null;
    });
    return this.op;
  }

  /** 停止：仅停止插件自己启动的服务；启动流程进行中也会立即停掉已 spawn 的子进程 */
  async stop(): Promise<void> {
    this.stopRequested = true;
    this.clearHealthWatch();
    if (this.child) {
      await this.stopOwned();
    } else {
      this.set({ state: 'idle', url: null, owned: false, error: null });
    }
  }

  private async stopOwned(): Promise<void> {
    this.clearHealthWatch();
    if (!this.child) {
      this.set({ state: 'idle', url: null, owned: false, error: null });
      return;
    }
    this.set({ state: 'stopping' });
    const child = this.child;
    this.child = null;
    try {
      await stopChildTree(child, this.deps.spawnImpl);
    } catch (err) {
      this.deps.log(`[process] 停止子进程失败: ${String(err)}`);
    }
    this.set({ state: 'idle', url: null, owned: false, error: null });
  }

  /** 完整启动流程 */
  private async doStart(): Promise<ServiceSnapshot> {
    this.set({ state: 'detecting', error: null });

    // 1) 运行时完整性检查（内置 Node + 内置 dsh CLI）
    const nodeExe = bundledNodeExe(this.opts.repoRoot);
    const bin = bundledDshBin(this.opts.repoRoot);
    if (!existsSync(nodeExe)) {
      this.set({ state: 'failed', error: 'err.runtimeNotFound', errorVars: { path: nodeExe } });
      return this.getSnapshot();
    }
    if (!existsSync(bin)) {
      this.set({ state: 'failed', error: 'err.dshNotFound', errorVars: { path: bin } });
      return this.getSnapshot();
    }

    const dshHome = this.opts.dshHome || defaultDshHome();
    const profile = this.opts.profile;

    // 2) 同步内置插件/皮肤到 profile（万物皆插件：与桌面版 syncAll 行为一致）
    if (this.opts.syncBuiltinPlugins && this.deps.core) {
      try {
        this.deps.core.ensureDesktopProfileInit();
        const r = this.deps.core.syncAll();
        if (!r.ok) this.deps.log(`[sync] 内置插件同步未完成: ${r.message ?? 'unknown'}`);
        this.deps.onSyncDone?.(this.deps.core.companionPluginsCount ?? 0);
      } catch (err) {
        this.deps.log(`[sync] 内置插件同步失败: ${String((err as Error)?.message ?? err)}`);
        // 同步失败不阻塞服务启动（dsh 原版也可直接跑）
      }
    }

    // 3) 探测目标端口上是否已有 DSH 在跑（复用）
    if (this.stopRequested) return this.getSnapshot();
    const probePort = this.opts.port > 0 ? this.opts.port : Number(this.deps.core?.loadSettings()?.webPort ?? 0) || 0;
    let existing: ProbeResult = 'down';
    if (probePort > 0) existing = await this.deps.probeService(this.opts.host, probePort, 3000);
    if (existing === 'dsh') {
      if (this.stopRequested) return this.getSnapshot();
      this.set({ state: 'ready', url: this.url(probePort), owned: false, port: probePort });
      this.startHealthWatch();
      this.deps.onReady?.(probePort, this.url(probePort));
      return this.getSnapshot();
    }

    if (!this.opts.autoStart) {
      this.set({ state: 'failed', error: 'err.notRunning' });
      return this.getSnapshot();
    }

    // 4) 端口被其他程序占用：自动临时替换为第一个空闲端口（仅本次会话生效）
    if (existing === 'foreign') {
      if (this.opts.port > 0) {
        const fallback = await findFreePort(
          this.opts.host,
          this.opts.port,
          PORT_FALLBACK_ATTEMPTS,
          this.deps.probeService,
          3000,
        );
        if (fallback !== null) {
          if (this.stopRequested) return this.getSnapshot();
          this.deps.log(`[process] 端口 ${this.opts.port} 被其他程序占用，本次会话临时改用端口 ${fallback}`);
          this.deps.onPortFallback?.(this.opts.port, fallback);
          this.set({ port: fallback });
          this.opts = { ...this.opts, port: fallback };
        } else {
          this.set({ state: 'failed', error: 'err.loadFailed', errorVars: { port: this.opts.port } });
          return this.getSnapshot();
        }
      }
    }

    // 5) 解析最终端口（自动模式：稳定端口选择器 + 持久化）
    const resolved = await resolvePort(this.opts, this.deps, null);
    const port = this.opts.port > 0 ? this.opts.port : resolved.port;
    if (this.stopRequested) return this.getSnapshot();

    // 6) 启动子进程
    this.set({ state: 'starting', port });
    const child = startDsh(
      {
        host: this.opts.host,
        port,
        profile,
        dshHome,
        nodeExe,
        bin,
        extraArgs: this.opts.extraArgs,
        patchOverlays: this.opts.patchOverlays,
        cwd: this.opts.cwd,
        openInBrowser: this.opts.openInBrowser,
      },
      this.deps.spawnImpl,
    );
    this.child = child;

    // 7) 等待就绪：就绪行 + HTTP 探测（首次引导放宽超时）
    const firstBoot = !existsSync(join(dshHome, 'profiles', profile, 'node_modules'));
    const timeoutMs = firstBoot ? this.opts.firstBootTimeoutMs : this.opts.startTimeoutMs;
    this.deps.log(`[dsh] 等待服务就绪（${firstBoot ? '首次引导，超时放宽至 ' + timeoutMs + 'ms' : timeoutMs + 'ms'}）`);

    const readyUrl = await this.waitReady(child, port, timeoutMs);
    if (this.stopRequested) {
      void this.stopOwned();
      return this.getSnapshot();
    }
    if (readyUrl === null) {
      const crashed = child.exitCode !== null && child.exitCode !== undefined;
      this.deps.log('[dsh] 服务未就绪' + (crashed ? '（进程已退出）' : '（超时）'));
      this.child = null;
      if (crashed) {
        this.set({ state: 'failed', error: 'err.startCrashed' });
      } else {
        this.set({ state: 'failed', error: 'err.startTimeout', errorVars: { seconds: Math.round(timeoutMs / 1000) } });
      }
      return this.getSnapshot();
    }

    this.set({ state: 'ready', url: this.url(port), owned: true, port });
    this.startHealthWatch();
    this.deps.onReady?.(port, this.url(port));
    return this.getSnapshot();
  }

  /** 等待就绪：就绪行或 HTTP 探测成功即返回 URL；进程退出/超时返回 null */
  private async waitReady(
    child: ChildProcessLike,
    port: number,
    timeoutMs: number,
  ): Promise<string | null> {
    const readyLine = waitForReadyLine(child, timeoutMs, (l) => this.deps.log(`[dsh] ${l}`));
    const httpUp = (async (): Promise<string | null> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = await this.deps.probeService(this.opts.host, port, 3000);
        if (r === 'dsh') return this.url(port);
        if (r === 'foreign') return null; // 端口被抢占：视为失败
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    })();
    const exit = new Promise<string | null>((resolve) => {
      child.on('exit', () => resolve(null));
    });
    return Promise.race([readyLine, httpUp, exit]);
  }

  /** 就绪后的健康探测：外部服务失联时回到 idle（由面板显示断开页） */
  private startHealthWatch(): void {
    this.clearHealthWatch();
    if (this.opts.healthIntervalMs <= 0) return;
    const port = this.snapshot.port;
    this.healthTimer = setInterval(async () => {
      const r = await this.deps.probeService(this.opts.host, port, 3000);
      if (r === 'dsh') return;
      this.deps.log(`[health] 服务失联（${r}），回到 idle`);
      this.clearHealthWatch();
      this.set({ state: 'idle', url: null, owned: false });
    }, this.opts.healthIntervalMs);
  }

  private clearHealthWatch(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHealthWatch();
    process.removeListener('exit', this.parentExitHook);
  }
}

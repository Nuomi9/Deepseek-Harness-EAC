// src/service/process.ts — dsh web 子进程封装（复用仓库内置 Node 运行时 + 内置 dsh CLI）
// 纯模块：spawn 通过参数注入，便于单测；不依赖 vscode。
import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 最小子进程接口（真实 ChildProcess 结构上兼容，测试可注入假实现） */
export interface ChildProcessLike {
  pid?: number;
  /** 进程退出码（已退出时非 null；用于区分崩溃与超时） */
  exitCode?: number | null;
  stdout?: { on(event: 'data', cb: (chunk: Buffer) => void): void };
  stderr?: { on(event: 'data', cb: (chunk: Buffer) => void): void };
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

/** spawn 函数签名（便于注入假实现） */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcessLike;

/** 启动参数 */
export interface StartOptions {
  host: string;
  port: number;
  /** dsh profile（web-desktop | web） */
  profile: string;
  /** DSH_HOME 目录（注入子进程环境变量） */
  dshHome: string;
  /** 内置 Node 运行时绝对路径（<repoRoot>/vendor/node/node.exe） */
  nodeExe: string;
  /** 内置 dsh CLI bin.js 绝对路径（<repoRoot>/node_modules/@deepseek-ai/dsh/lib/bin.js） */
  bin: string;
  /** 用户透传的额外参数（追加在命令尾部） */
  extraArgs: string[];
  /** 额外的 --patch overlay 文件（用户自定义插件补丁入口，仅传存在的文件） */
  patchOverlays: string[];
  /** 子进程工作目录（兜底：让 dsh web 以 VS Code 工作区为 cwd） */
  cwd?: string;
  /** 是否允许 dsh web 打开浏览器（true=不追加 --no-open） */
  openInBrowser?: boolean;
}

/** 解析仓库根目录（vscode/ 子目录的上一级） */
export function repoRootFromExtensionRoot(extensionRoot: string): string {
  return require('node:path').dirname(extensionRoot);
}

/** 内置 Node 运行时路径（<root>/vendor/node/node.exe） */
export function bundledNodeExe(repoRoot: string): string {
  const { join } = require('node:path');
  return join(repoRoot, 'vendor', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
}

/** 内置 dsh CLI bin.js 路径（<root>/node_modules/@deepseek-ai/dsh/lib/bin.js） */
export function bundledDshBin(repoRoot: string): string {
  const { join } = require('node:path');
  return join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}

/**
 * 启动 dsh web 子进程（复用内置运行时，行为与桌面版 main.js startServer 对齐）：
 *   node --use-system-ca <bin> --profile <profile> --host <host> --port <port> --no-open [--patch ...] [...extraArgs]
 * 环境变量注入 DSH_HOME 与 DSH_DESKTOP_PROFILE（与桌面端 childEnv 一致）。
 */
export function startDsh(opts: StartOptions, spawnImpl: SpawnFn = spawn as unknown as SpawnFn): ChildProcessLike {
  const webArgs = [
    '--use-system-ca',
    opts.bin,
    '--profile',
    opts.profile,
    '--host',
    opts.host,
    '--port',
    String(opts.port),
  ];
  // 默认不让 dsh 弹浏览器（嵌入面板场景无需浏览器）：除非用户打开 openInBrowser 开关
  if (opts.openInBrowser !== true) webArgs.push('--no-open');
  // 额外的 --patch overlay：仅透传真实存在的文件（用户自定义插件补丁入口）
  for (const p of opts.patchOverlays) {
    if (typeof p === 'string' && p.length > 0 && existsSync(p)) webArgs.push('--patch', p);
  }
  // 用户透传的额外参数（最后追加）
  webArgs.push(...opts.extraArgs);

  const spawnOptions: SpawnOptions = {
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DSH_HOME: opts.dshHome,
      DSH_DESKTOP_PROFILE: opts.profile,
      // 禁用桌面端的启动动画/托盘等 Electron 壳专属行为，仅保留 web 服务本体
      DSH_DESKTOP_BARE: '1',
    },
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  };

  const child = spawnImpl(opts.nodeExe, webArgs, spawnOptions) as ChildProcessLike;
  return child;
}

/**
 * 解析 dsh web 子进程 stdout，等待就绪 URL 行。
 * 桌面版 main.js 打印的格式：`dsh web: http://127.0.0.1:<port>/`。
 * 返回 { url } 或 null（进程退出/超时前未就绪）。
 */
export function readyLinePattern(): RegExp {
  return /dsh web:\s+(https?:\/\/\S+)/;
}

/**
 * 等待 dsh web 子进程 stdout 出现就绪 URL 行；进程提前退出 / 超时则返回 null。
 * @param child   子进程（需提供 stdout/stderr/on('exit')）
 * @param timeoutMs 等待超时（毫秒）
 * @param onLog   可选的行日志回调（写入输出通道）
 * @returns 就绪 URL；超时或进程退出返回 null
 */
export function waitForReadyLine(
  child: ChildProcessLike,
  timeoutMs: number,
  onLog?: (line: string) => void,
): Promise<string | null> {
  return new Promise((resolve) => {
    const pattern = readyLinePattern();
    let buf = '';
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(val);
    };

    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      if (onLog) {
        for (const line of buf.split('\n')) if (line.trim()) onLog(line);
      }
      const m = buf.match(pattern);
      if (m) finish(m[1]);
      // 防止内存膨胀：只保留末尾 64KB
      if (buf.length > 65536) buf = buf.slice(-65536);
    };
    const onExit = (code: number | null) => {
      finish(null);
    };
    const onError = () => finish(null);

    child.stdout?.on('data', onData);
    child.on('exit', onExit);
    child.on('error', onError);
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * 停止 dsh web 子进程（Windows 用 taskkill /T 杀整个进程树，参照桌面版 killTreeAndWait）。
 * @returns 进程是否已退出（不再需要强杀）
 */
export async function stopChildTree(
  child: ChildProcessLike,
  spawnImpl: SpawnFn = spawn as unknown as SpawnFn,
  platform: string = process.platform,
  graceMs = 1500,
): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;
  if (platform === 'win32') {
    // 优雅 taskkill（无 /F）→ 短等待 → 仍存活则 /F 强杀
    spawnImpl('taskkill', ['/pid', String(pid), '/T'], { windowsHide: true, stdio: 'ignore' });
    const exited = await new Promise<boolean>((resolve) => {
      let done = false;
      child.on('exit', () => {
        done = true;
        resolve(true);
      });
      setTimeout(() => resolve(done), graceMs);
    });
    if (!exited) {
      try {
        spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch {
        /* 进程可能已退出，忽略 */
      }
    }
    return;
  }
  // POSIX：先 SIGTERM，宽限期后 SIGKILL
  try {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, graceMs));
    child.kill('SIGKILL');
  } catch {
    /* 忽略 */
  }
}

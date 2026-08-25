// src/core/desktopCore.ts — 包装仓库根的 desktop-core.js（Tauri sidecar 业务编排层）
//
// 背景：desktop-core.js 是 lite-Windows 分支的插件生态编排层（内置插件/皮肤同步、
// 插件启停管理、保护中心、市场排队任务、余额、更新），设计上不 require('electron')，
// 全部副作用经 ctx（log/notify）注入 —— 因此 VS Code 扩展可以原样复用，从而完整保留
// DeepSeek Harness「万物皆插件」的生态能力（与桌面版零行为漂移）。
//
// 关键点：desktop-core.js 内部用 __dirname 解析 assets/plugins、assets/skins、node_modules
// 等相对路径，绝不能被打包进扩展（否则 __dirname 变成 out/ 导致资产路径失效）。
// 因此这里用 eval('require') 在运行时从仓库根加载原始模块，esbuild 无法静态解析、
// 也不会打包它。扩展必须与仓库同目录使用（vscode/ 是仓库的一个子目录）。

import { join } from 'node:path';
import type { DesktopCoreApi } from '../service/manager';

/** desktop-core 工厂的真实签名（从仓库根动态加载） */
interface DesktopCoreFactory {
  createDesktopCore(ctx: {
    appRoot: string;
    userDataDir: string;
    logsDir: string;
    dshHome: string;
    nodeExe: () => string;
    npmCli: () => string;
    log?: (tag: string, msg: string) => void;
    notify?: (title: string, body: string) => void;
  }): DesktopCoreApi & { COMPANION_PLUGINS: unknown[] };
}

/** 加载仓库根的 desktop-core 模块（仅加载一次） */
let coreModuleCache: DesktopCoreFactory | null = null;
export function loadDesktopCoreModule(repoRoot: string): DesktopCoreFactory {
  if (coreModuleCache) return coreModuleCache;
  // eval('require')：让 esbuild 无法静态解析，保证运行时从仓库根加载原始 CJS 模块
  const nodeRequire = eval('require') as NodeRequire;
  coreModuleCache = nodeRequire(join(repoRoot, 'desktop-core.js')) as DesktopCoreFactory;
  return coreModuleCache;
}

/** 创建 desktop-core 实例（注入 vscode 上下文回调） */
export function createDesktopCore(
  repoRoot: string,
  deps: {
    userDataDir: string;
    logsDir: string;
    dshHome: string;
    nodeExe: () => string;
    npmCli: () => string;
    log?: (tag: string, msg: string) => void;
    notify?: (title: string, body: string) => void;
  },
): DesktopCoreApi {
  const factory = loadDesktopCoreModule(repoRoot);
  const core = factory.createDesktopCore({
    appRoot: repoRoot,
    userDataDir: deps.userDataDir,
    logsDir: deps.logsDir,
    dshHome: deps.dshHome,
    nodeExe: deps.nodeExe,
    npmCli: deps.npmCli,
    log: deps.log ?? (() => {}),
    notify: deps.notify ?? (() => {}),
  });
  return {
    ...core,
    companionPluginsCount: core.COMPANION_PLUGINS?.length ?? 0,
  };
}

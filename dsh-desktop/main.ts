/**
 * main.ts — DSH Desktop 装配入口（Electron 主进程组合根）（Task 7.1 自
 * main.js 迁 TS；编译产物 main.js 即 package.json 的 main 入口）。
 *
 * 本文件只做装配：跨域 bridge 注入 + 应用生命周期接线。全部业务逻辑已按
 * 单一职责迁入 lib/（TypeScript，`npm run build` 原地编译为同名 .js）：
 *   基础层  state / log / proc / paths / bridge
 *   运行层  run-state / watchdog-boot / server / terminal / preview
 *   界面层  window / tray / ipc/* / onboarding
 *   插件层  plugin-registry-data / plugin-copy / plugin-manager-core /
 *           plugins / market-ops / market-modules / session-heal / guard
 *   更新层  update-flow（agent 流）/ client-update（客户端流）
 *   隔离层  supervisor/* / extension-host/* / recovery-center（VNext）
 *   其他    balance-ui / shortcuts / preflight / boot
 *
 * What it does:
 *   1. Boots the bundled dsh CLI ("dsh web") with a standalone Node runtime.
 *   2. Waits until the web UI answers HTTP on 127.0.0.1:<free-port>.
 *   3. Shows it in a native window; quits the server when the app exits.
 *   4. Checks for official @deepseek-ai/dsh releases and, with the user's
 *      consent, self-updates the agent (see lib/update-flow.ts).
 *
 * The dsh CLI is spawned with the bundled node.exe (vendor/node/node.exe in
 * dev, resources/node/node.exe when packaged) so that prebuilt native
 * modules (sharp, node-pty, koffi, ...) match the Node ABI they were
 * installed for. We deliberately never rebuild them against Electron.
 */

import { app, clipboard, dialog, Menu, Notification, shell } from 'electron';
import { spawn } from 'node:child_process';

// ── lib 装配表（bridge 注入需要运行期引用；保持 require 顺序稳定）──────
import { state } from './lib/state.js';
import { log } from './lib/log.js';
import { IS_WIN, killTreeAndWait } from './lib/proc.js';
import { bridge } from './lib/bridge.js';
import { closeAllFloatWindows, showBox } from './lib/window.js';
import { showMainWindow, getExitAction, askExitAction, trayHintOnce } from './lib/tray.js';
import { ensureGuard } from './lib/guard.js';
import { syncCompanionPlugins, healProfileModules, restoreKeptArtifacts } from './lib/plugins.js';
import { processPendingMarketOps } from './lib/market-ops.js';
import { runUpdateFlow, runClientUpdateFlow } from './lib/update-flow.js';
import { boot, fatal, handleBootFailure } from './lib/boot.js';
import { initHostCtx, hostCtx } from './lib/host-ctx.js';
import { setDefaultIpcSurface } from './lib/ipc/transport.js';
import { shutdownExtensionHosts } from './lib/extension-host/manager.js';
import { snapshotScheduler } from './lib/snapshot/scheduler.js';
import * as structuredLogger from './logger.js';
import * as updaterReal from './updater.js';

// ── Electron 宿主适配器（Task 6 Wave 3：组合根侧的 electron 机制落位）────
// lib/ 已零 electron 依赖（Wave 1/2 中立化），窗口/托盘/IPC 传输的全部
// Electron 机制在 host-electron/ 实现，经 initHostCtx / setDefaultIpcSurface
// 注入（Tauri sidecar 的对等装配在 tauri-shell/sidecar/server.ts）。
import { electronIpcSurface } from './host-electron/ipc.js';
import { electronWindows, getMainWindow } from './host-electron/windows.js';
import { electronTray } from './host-electron/tray.js';

// 跨域注入点装配（lib/bridge.ts 的默认实现只是警告占位；这里在模块加载期
// 指向真实实现 —— 装配早于任何事件回调，语义等价于原 main.js 闭包直调）。
bridge.showMainWindow = showMainWindow;
bridge.showBox = showBox;
bridge.ensureGuard = ensureGuard;
bridge.handleBootFailure = handleBootFailure;
bridge.processPendingMarketOps = processPendingMarketOps;
bridge.syncCompanionPlugins = syncCompanionPlugins;
bridge.healProfileModules = healProfileModules;
bridge.restoreKeptArtifacts = restoreKeptArtifacts;
bridge.getExitAction = getExitAction;
bridge.askExitAction = askExitAction;
bridge.trayHintOnce = trayHintOnce;
bridge.runUpdateFlow = runUpdateFlow;
bridge.runClientUpdateFlow = runClientUpdateFlow;

// ── 宿主上下文注入（Task 5.3：Electron 适配器）──────────────────────────
// lib/* 统一模块经 lib/host-ctx.ts 取宿主能力、不直接 import electron；
// 组合根 main.ts 是 electron import 的合法装配点，这里把 Electron API 面
// 逐项映射为 HostCtx（sidecar 侧对等实现在 tauri-shell/sidecar/server.ts）。
initHostCtx({
  isPackaged: () => app.isPackaged,
  resourcesPath: () => process.resourcesPath,
  appVersion: () => app.getVersion(),
  log: (tag, msg) => log(tag, msg),
  exitProcess: (code) => app.exit(code),
  requestQuit: () => app.quit(),
  notify: (opts) => {
    // exactOptionalPropertyTypes：icon 仅在存在时传入（undefined 不可赋给可选属性）。
    const n = new Notification({ title: opts.title, body: opts.body, ...(opts.icon ? { icon: opts.icon } : {}) });
    if (opts.onClick) n.on('click', opts.onClick);
    n.show();
  },
  copyToClipboard: (text) => clipboard.writeText(text),
  getPath: (name) => app.getPath(name),
  setPath: (name, value) => app.setPath(name, value),
  removeAppMenu: () => Menu.setApplicationMenu(null),
  // 原 showBox「有主窗时挂主窗（模态感）」语义在此恢复：宿主窗口面持有
  // 主窗引用（host-electron/windows.ts），消息框无主窗时走无父窗重载。
  showMessageBox: (opts) => {
    const mw = getMainWindow();
    return mw ? dialog.showMessageBox(mw, opts) : dialog.showMessageBox(opts);
  },
  shortcuts: {
    readLink: (p) => shell.readShortcutLink(p),
    writeLink: (p, operation, o) => shell.writeShortcutLink(p, operation, o),
  },
  // Task 6 Wave 2 契约演进补齐（HostCtx 扩面）：直映射 Electron shell/app。
  openExternal: (url) => { void shell.openExternal(url); },
  openPath: (p) => { void shell.openPath(p); },
  showItemInFolder: (p) => shell.showItemInFolder(p),
  // 完全重启（HostCtx 契约「安排 relaunch 后立即退出」）：relaunch + quit
  // 对齐原托盘完全重启语义（11be738 的 app.relaunch()+app.quit()，走优雅
  // 退出链）。update-flow/恢复中心的「退出重启装更新」场景在 relaunch 后
  // 紧跟 exitProcess(0) 立即收口（等价原 app.exit(0) 直退）；安全模式同。
  relaunch: () => {
    app.relaunch();
    app.quit();
  },
  // Task 6 Wave 3：窗口/托盘宿主面（lib 的 createWindow/createTray/浮窗/
  // 恢复中心/向导/更新进度窗全部经此委托；未注入时 lib 按无窗宿主降级）。
  windows: electronWindows(),
  tray: electronTray(),
});

// IPC 传输面注入（Task 6.1）：boot 链 registerIpc() 取缺省注册面挂载全部
// 42 个 channel —— 必须早于 app.whenReady → boot；来源 token＝webContents.id。
setDefaultIpcSurface(electronIpcSurface());

// ---------------------------------------------------------------------------
// App lifecycle（唯一留在入口的职责：单实例锁 + 退出清理）
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.deepseek.dsh.desktop');
  app.on('second-instance', () => {
    // Task 6 Wave 2 契约演进：BrowserWindow 句柄已会话化（state.mainSession），
    // 显示/聚焦主窗经 tray 域的 showMainWindow（宿主窗口面接线在 Wave 3）。
    showMainWindow();
  });
  app.on('before-quit', (event) => {
    // V4：退出必须等 dsh web 进程树真正死透再退（见 killTreeAndWait 注释）。
    // 首次事件里阻止默认退出，完成异步清理后 app.exit(0)；后续重复事件
    // （window-all-closed 触发的 app.quit 等）直接放行。
    if (state.shutdownInProgress) return;
    state.shutdownInProgress = true;
    event.preventDefault();
    state.quitting = true;
    state.forceQuit = true;
    const t0 = Date.now();
    log('boot', '正在退出，停止 dsh web 进程树…');
    const { markCleanExit } = require('./lib/run-state.js') as typeof import('./lib/run-state.js');
    markCleanExit();
    void (async () => {
      try {
        closeAllFloatWindows();
        // 正在跑的插件市场排队任务：直接强杀（它只是 pnpm 的转发器，
        // 标记文件的 attempts 机制会在下次启动重试）。
        if (state.marketOpChild && state.marketOpChild.pid && state.marketOpChild.exitCode === null) {
          try {
            spawn('taskkill', ['/pid', String(state.marketOpChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          } catch {
            /* 已退出 */
          }
        }
        await killTreeAndWait(state.serverProc);
        // VNext Phase 2：树杀全部 SDK 插件 Host（Job 围栏下 Supervisor 崩溃
        // 也有 OS 兜底回收；此处覆盖正常退出路径）。
        await shutdownExtensionHosts();
        updaterReal.abort();
        if (state.sessionWatcher) state.sessionWatcher.stop();
        snapshotScheduler.stop();
      } catch (err) {
        log('boot', '退出清理异常: ' + String((err as Error)?.message));
      } finally {
        if (state.balanceTimer) clearInterval(state.balanceTimer);
        // Task 6 Wave 2 契约演进：托盘句柄留在宿主层，销毁经 HostTray.destroy
        //（未创建时静默；托盘存在性判断统一走 state.trayActive）。
        try {
          hostCtx().tray?.destroy();
        } catch {
          /* 已销毁 */
        }
        log('boot', `退出清理完成（耗时 ${Date.now() - t0}ms）`);
        // 日志系统 flush：结构化 logger 先关（flush 缓冲区+结束 rotation stream），
        // 再关 desktop.log 纯文本，保证退出前两条通道都落盘。
        try {
          structuredLogger.close();
        } catch {
          /* 已关 */
        }
        try {
          if (state.desktopLog) state.desktopLog.end();
        } catch {
          /* 已关 */
        }
        app.exit(0);
      }
    })();
  });
  // 关闭窗口后常驻托盘；托盘不存在时才随窗口退出（存在性经 state.trayActive，
  // 宿主 create() 成功后置位 —— Task 6.2 托盘契约）。
  app.on('window-all-closed', () => {
    if (!IS_WIN || !state.trayActive) app.quit();
  });
  app
    .whenReady()
    .then(boot)
    .catch((err: unknown) => fatal('应用初始化失败', err));
}

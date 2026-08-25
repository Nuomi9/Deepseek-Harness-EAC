/**
 * host-electron/windows.ts — Electron 窗口宿主面（Task 6 Wave 3）。
 *
 * HostWindows（lib/host-ctx.ts）的 Electron 实现：Wave 1/2 把窗口机制从
 * lib/window.ts、lib/onboarding.ts、lib/recovery-center/register.ts、
 * lib/update-flow.ts 中立化剥离后，全部 Electron 机制（BrowserWindow 构造、
 * 导航/开窗围栏、右键菜单、快捷键、最大化同步、关闭策略、浮窗 partition
 * 隔离、向导/恢复中心/更新进度窗生命周期、renderer-recovery 挂接）在本文件
 * 落位 —— 移植底本为 git HEAD 的原实现，语义逐段等价。
 *
 * 窗口引用持有在模块内（mainWindow / floatWins / wizardWindow / rcWindow），
 * 不进 state；state 只登记宿主中立的 BridgeSession（mainSession /
 * floatSessions/floatBySession / wizardSession / rcSession），IPC 来源校验
 * （lib/ipc/sender.ts、lib/recovery-center/register.ts）据此比对 token＝
 * String(webContents.id)。
 *
 * 本文件属组合根侧（electron import 的合法装配点）；对 lib/ 的 import 方向
 * 合法（宿主消费中立模块：isAllowedWebUrl/attachWindowToRecovery/FLOAT_MAX/
 * closeWizard 等）。
 */

import * as path from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import type { WebContents } from 'electron';
import { state } from '../lib/state.js';
import { log } from '../lib/log.js';
import { IS_WIN } from '../lib/proc.js';
import { bridge } from '../lib/bridge.js';
import { hostCtx } from '../lib/host-ctx.js';
import type {
  HostWindows, BridgeSession, UpdateProgressHandle, OpenUpdateProgressOpts,
} from '../lib/host-ctx.js';
import type { RecoveryWindow } from '../renderer-recovery.js';
import { isAllowedWebUrl, attachWindowToRecovery, FLOAT_MAX } from '../lib/window.js';
import { closeWizard } from '../lib/onboarding.js';

// ---------------------------------------------------------------------------
// 模块内窗口引用（不进 state —— state 只存宿主中立的 BridgeSession）
// ---------------------------------------------------------------------------

/** 主窗（createMain 创建 / closed 置空 / 恢复流程销毁重建）。 */
let mainWindow: BrowserWindow | null = null;

/** 会话浮窗：sessionId → BrowserWindow（token 查找经 webContents.id 比对）。 */
const floatWins = new Map<string, BrowserWindow>();

/** 内置插件选择向导窗口（closed→closeWizard 取消收口）。 */
let wizardWindow: BrowserWindow | null = null;

/** 恢复中心窗口（rcSession 契约见 lib/recovery-center/register.ts）。 */
let rcWindow: BrowserWindow | null = null;

/** 主窗引用（main.ts 的 showMessageBox 适配器挂主窗模态用；无主窗为 null）。 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

// ---------------------------------------------------------------------------
// 共享工具：右键菜单 + 导航围栏（移植自原 lib/window.ts，Wave 1 迁出）
// ---------------------------------------------------------------------------

// V4（用户反馈）：浏览器风格的右键菜单。Electron 不展示 Chromium 的内置
// 右键菜单，需在 webContents 的 context-menu 事件自建：
//   · 可编辑区（输入框/编辑器）→ 撤销/重做/剪切/复制/粘贴/删除/全选
//     （role 菜单自动路由到焦点渲染进程的编辑器，enabled 用 editFlags
//     精确反映可操作性）；
//   · 图片 → 复制图片 / 图片另存为…；
//   · 选中文本 → 复制 / 全选；
//   · 其余页面区域 → 后退/前进/重新加载（浏览器同款导航段）。
// 页面自绘右键交互（DOM contextmenu 已处理并 preventDefault 时，
// params 仍会派发）—— Web UI 目前未使用原生右键，无冲突。
function attachEditContextMenu(wc: WebContents): void {
  wc.on('context-menu', (_e, params) => {
    const flags = params.editFlags || {};
    const win = BrowserWindow.fromWebContents(wc);
    if (!win || win.isDestroyed()) return;
    let template: Electron.MenuItemConstructorOptions[] | null = null;
    if (params.isEditable) {
      template = [
        { label: '撤销', role: 'undo', accelerator: 'Ctrl+Z', enabled: flags.canUndo !== false },
        { label: '重做', role: 'redo', accelerator: 'Ctrl+Y', enabled: flags.canRedo !== false },
        { type: 'separator' },
        { label: '剪切', role: 'cut', accelerator: 'Ctrl+X', enabled: flags.canCut !== false },
        { label: '复制', role: 'copy', accelerator: 'Ctrl+C', enabled: flags.canCopy !== false },
        { label: '粘贴', role: 'paste', accelerator: 'Ctrl+V', enabled: flags.canPaste !== false },
        { label: '删除', role: 'delete', enabled: flags.canDelete !== false },
        { type: 'separator' },
        { label: '全选', role: 'selectAll', accelerator: 'Ctrl+A' },
      ];
    } else if (params.mediaType === 'image' && params.srcURL) {
      template = [
        { label: '复制图片', click: () => { try { wc.copyImageAt(params.x, params.y); } catch { /* 老版本无此 API */ } } },
        { label: '图片另存为…', click: () => { try { wc.downloadURL(params.srcURL); } catch { /* 老版本无此 API */ } } },
      ];
      if (flags.canCopy) {
        template.push({ type: 'separator' }, { label: '复制', role: 'copy', accelerator: 'Ctrl+C' });
      }
    } else if (flags.canCopy) {
      template = [
        { label: '后退', enabled: wc.navigationHistory.canGoBack?.() ?? wc.canGoBack(), click: () => { try { wc.navigationHistory.goBack?.(); } catch { wc.goBack(); } } },
        { label: '前进', enabled: wc.navigationHistory.canGoForward?.() ?? wc.canGoForward(), click: () => { try { wc.navigationHistory.goForward?.(); } catch { wc.goForward(); } } },
        { label: '重新加载', role: 'reload', accelerator: 'Ctrl+R' },
        { type: 'separator' },
        { label: '复制', role: 'copy', accelerator: 'Ctrl+C' },
        { label: '全选', role: 'selectAll', accelerator: 'Ctrl+A' },
      ];
    } else {
      template = [
        { label: '后退', enabled: wc.navigationHistory.canGoBack?.() ?? wc.canGoBack(), click: () => { try { wc.navigationHistory.goBack?.(); } catch { wc.goBack(); } } },
        { label: '前进', enabled: wc.navigationHistory.canGoForward?.() ?? wc.canGoForward(), click: () => { try { wc.navigationHistory.goForward?.(); } catch { wc.goForward(); } } },
        { label: '重新加载', role: 'reload', accelerator: 'Ctrl+R' },
      ];
    }
    if (template && template.length) {
      Menu.buildFromTemplate(template).popup({ window: win, x: params.x, y: params.y });
    }
  });
}

/** 外部链接转系统浏览器（开窗围栏 + 导航围栏共用）。 */
function openExternalIfHttp(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

// H1（共享给主窗/浮窗）：origin 精确比较（protocol+host+port），杜绝前缀/
// 异域/userinfo 逃逸；file: 一律拦截（同 webContents 下 file 页面仍持有
// preload 桥）。围栏判定用 lib/window.ts 的 isAllowedWebUrl（宿主中立）。
function guardNavigation(event: Electron.Event, url: string): void {
  if (isAllowedWebUrl(url)) return;
  event.preventDefault();
  openExternalIfHttp(url);
}

/** 浮窗 webContents 围栏：与主窗同规则的导航/开窗拦截 + 浮窗专属错误采集。 */
function guardFloatWebContents(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    openExternalIfHttp(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', guardNavigation);
  wc.on('will-redirect', guardNavigation);
  wc.on('console-message', (details, level, message, line, sourceId) => {
    const text = String((details && details.message) || message || '');
    const lvl = String((details && details.level) || level);
    const src = (details && details.sourceId) || sourceId || 'unknown';
    const lineNo = (details && details.lineNumber) ?? line;
    if (lvl === 'error' || lvl === '3' || lvl === 'warning' || lvl === '2' || /\[dsh-float-window\]/.test(text)) {
      log('float-page', `[${lvl}] ${text} (${String(src)}:${String(lineNo)})`);
    }
  });
}

// ---------------------------------------------------------------------------
// 主窗（移植自原 lib/window.ts createWindow）
// ---------------------------------------------------------------------------

/**
 * 创建主窗口并装配全部行为：加载态页 → ready-to-show 再显示；导航/开窗围栏
 * （外部链接转系统浏览器）；页面错误采集；F11/F12/Ctrl+R/Alt+F4 快捷键；
 * 最大化状态同步（自绘标题栏按钮用）；关闭按退出策略分流；BridgeSession
 * 登记进 state.mainSession；末尾挂 renderer-recovery。startHidden 供恢复
 * 流程后台重建。
 */
function createMain(opts: { startHidden?: boolean } = {}): void {
  const { startHidden = false } = opts;
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Deepseek Harness EAC',
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    // 风格化无边框窗口：去掉原生标题栏/菜单栏，自绘玻璃栏 + Win11 原生圆角。
    ...(IS_WIN ? { frame: false, roundedCorners: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = win;

  win.loadFile(path.join(__dirname, '..', 'assets', 'loading.html'));
  win.once('ready-to-show', () => {
    if (!startHidden && !win.isDestroyed()) win.show();
  });
  // Keep the app brand in the OS title bar (the web UI sets its own <title>).
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    if (!win.isDestroyed()) win.setTitle('Deepseek Harness EAC');
  });

  // Open target=_blank / window.open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfHttp(url);
    return { action: 'deny' };
  });

  // Keep the app pinned to the local web UI; send external links out.
  // H1 修复：origin 精确比较；will-redirect 同规则。
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);

  // 渲染进程错误捕获：插件/页面异常统一落到 desktop.log，便于排查空白视图。
  // （新版 Electron 的 level 为数字，旧版为字符串——String 归一后比较，兼容两端。）
  win.webContents.on(
    'console-message',
    (_e, level, message, line, sourceId) => {
      const lvl = String(level);
      if (lvl === 'error' || lvl === '3' || lvl === 'warning' || lvl === '2') {
        log('page', `[${lvl}] ${String(message)} (${sourceId || 'unknown'}:${line})`);
      }
    },
  );
  // V4：浏览器风格右键菜单（编辑/图片/选区/导航四类场景）。
  attachEditContextMenu(win.webContents);
  win.webContents.on('render-process-gone', (_e, details) => {
    log('page', `渲染进程异常退出: ${details.reason} (exitCode=${details.exitCode})`);
  });

  // 移除菜单栏后仍保留的键盘快捷键（Ctrl+R 走 reloadMain 语义：恢复页
  // gaveUp 分支改走恢复流程 retryNow）。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const mw = mainWindow;
    if (!mw) return;
    if (input.key === 'F11') { mw.setFullScreen(!mw.isFullScreen()); event.preventDefault(); }
    else if (input.key === 'F12') { mw.webContents.toggleDevTools(); event.preventDefault(); }
    else if (input.control && input.shift && key === 'i') { mw.webContents.toggleDevTools(); event.preventDefault(); }
    else if (input.control && key === 'r') { reloadMain(); event.preventDefault(); }
    else if (input.alt && key === 'f4') { mw.close(); event.preventDefault(); }
  });

  // 自绘最大化/还原按钮需要感知窗口状态。
  const sendMaxState = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chrome:maximized', mainWindow.isMaximized());
    }
  };
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);
  win.on('enter-full-screen', sendMaxState);
  win.on('leave-full-screen', sendMaxState);

  // 关闭 → 按退出行为设置处理：ask 弹窗询问 / minimize 隐藏到托盘 / quit 退出。
  // （托盘存在性经 state.trayActive —— 宿主托盘 create() 成功后置位。）
  win.on('close', async (event) => {
    if (state.forceQuit || !IS_WIN || !state.trayActive) return;
    event.preventDefault();
    const action = bridge.getExitAction();
    let choice = action;
    if (action === 'ask') {
      choice = await bridge.askExitAction();
      // 弹窗期间用户可能已通过菜单真正退出（quitting/forceQuit 置位）。
      if (state.forceQuit || state.quitting) return;
    }
    if (choice === 'minimize') {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      bridge.trayHintOnce();
    } else {
      state.forceQuit = true;
      app.quit();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    // closed 后窗口已销毁（访问 webContents 会抛「Object has been
    // destroyed」），比对用创建期捕获的 id。
    if (state.mainSession && state.mainSession.id === wcId) {
      state.mainSession = null;
    }
  });

  // 桥会话登记（IPC 来源校验 token＝webContents.id；见文件头）。
  const wcId = String(win.webContents.id);
  const session: BridgeSession = {
    id: wcId,
    send: (channel, payload) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
    },
    focus: () => { if (!win.isDestroyed()) win.focus(); },
    close: () => { if (!win.isDestroyed()) win.close(); },
    isAlive: () => !win.isDestroyed() && !win.webContents.isDestroyed(),
  };
  state.mainSession = session;

  // 渲染进程崩溃/挂起的自恢复由 renderer-recovery.js 统一接管（保留上方
  // render-process-gone 的日志 handler，二者互补：一个记录、一个恢复）。
  attachWindowToRecovery(win, 'main');
}

// ---------------------------------------------------------------------------
// 会话浮窗（V4 多窗口，移植自原 createFloatWindow + chrome:float-window 的
// reuse 分支；登记 state.floatSessions/floatBySession）
// ---------------------------------------------------------------------------

function openFloatWindow(sessionId: string): { ok: boolean; id?: number; reused?: boolean; error?: string } {
  // 同一会话只保留一个浮窗：拖出/按钮连续触发或重复请求时，
  // 复用已有窗口而不是再开第二个。
  const existing = floatWins.get(sessionId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true, id: existing.id, reused: true };
  }
  if (existing) floatWins.delete(sessionId);
  if (!state.webUrl || state.floatSessions.size >= FLOAT_MAX) return { ok: false, error: 'too-many' };

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'DSH 会话',
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    // 与主窗一致的无边框；浮窗 preload 注入一条更细的纯拖拽条。
    ...(IS_WIN ? { frame: false, roundedCorners: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 独立分区：浮窗与主窗隔离 localStorage，避免互相覆盖 dsh.sessions.current。
      // 会话数据在服务端（~/.dsh），localStorage 仅存 UI 选中态，无 cookie 认证。
      partition: 'persist:dsh-float',
      // 用 additionalArguments 而非 URL 参数，避免污染 Web UI 见到的地址；
      // preload 从 process.argv 读取 --dsh-float=<sessionId>。
      additionalArguments: ['--dsh-float=' + sessionId],
    },
  });
  floatWins.set(sessionId, win);
  win.loadURL(state.webUrl).catch((err) => log('float', '浮窗加载失败: ' + String((err && (err as Error).message) || err)));

  // 窗口标题跟随会话（去掉通用前缀，保留会话相关标题）。
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    // Electron 类型未标 title 字段（运行时存在）——宽化读取。
    const evTitle = (event as Electron.Event & { title?: string }).title;
    const raw = String(evTitle || win.getTitle() || '');
    const cleaned = raw.replace(/^(DSH|Deepseek Harness EAC)[·\-—\s:]*/i, '').trim();
    win.setTitle(cleaned || 'DSH 会话');
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on('closed', () => {
    floatWins.delete(sessionId);
    const s = state.floatBySession.get(sessionId);
    if (s) {
      state.floatSessions.delete(s);
      state.floatBySession.delete(sessionId);
    }
  });

  const session: BridgeSession = {
    id: String(win.webContents.id),
    send: (channel, payload) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
    },
    focus: () => { if (!win.isDestroyed()) win.focus(); },
    // 退出清理语义＝原 closeAllFloatWindows 的强收（destroy 跳过 close 钩子）。
    close: () => { if (!win.isDestroyed()) win.destroy(); },
    isAlive: () => !win.isDestroyed() && !win.webContents.isDestroyed(),
  };
  state.floatSessions.add(session);
  state.floatBySession.set(sessionId, session);

  guardFloatWebContents(win.webContents);
  attachEditContextMenu(win.webContents);
  attachWindowToRecovery(win, 'float');
  log('float', '已创建会话浮窗 sessionId=' + sessionId);
  return { ok: true, id: win.id };
}

/** 浮窗关闭：仅允许浮窗关闭自身（来源 token 命中已登记浮窗的 webContents.id）。 */
function closeFloatByToken(token: string): void {
  for (const win of floatWins.values()) {
    if (!win.isDestroyed() && String(win.webContents.id) === token) {
      win.close();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 恢复中心窗口（移植自原 lib/recovery-center/register.ts 窗口段）
// ---------------------------------------------------------------------------

function openRecoveryCenter(): void {
  if (rcWindow && !rcWindow.isDestroyed()) {
    rcWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: '恢复中心',
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'assets', 'recovery-center-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  rcWindow = win;
  // 创建期捕获（closed 后窗口已销毁，不可再读 webContents）。
  const wcId = String(win.webContents.id);
  const session: BridgeSession = {
    id: wcId,
    send: (channel, payload) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
    },
    focus: () => { if (!win.isDestroyed()) win.focus(); },
    close: () => { if (!win.isDestroyed()) win.close(); },
    isAlive: () => !win.isDestroyed() && !win.webContents.isDestroyed(),
  };
  // rc:action/rc:close 的来源校验据此比对会话 token（register.ts 契约）。
  state.rcSession = session;
  void win.loadFile(path.join(__dirname, '..', 'assets', 'recovery-center.html'));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on('closed', () => {
    if (rcWindow === win) rcWindow = null;
    if (state.rcSession && state.rcSession.id === wcId) {
      state.rcSession = null;
    }
  });
}

function closeRecoveryCenter(): void {
  const win = rcWindow;
  rcWindow = null;
  state.rcSession = null;
  if (win && !win.isDestroyed()) win.close();
}

// ---------------------------------------------------------------------------
// 内置插件选择向导窗口（移植自原 lib/onboarding.ts 窗口段；生命周期经
// lib/onboarding.ts 的 closeWizard 收口 —— submit/close/窗口 closed 三路共用）
// ---------------------------------------------------------------------------

function openPluginWizard(mode: 'first' | 'rerun'): boolean {
  const win = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 640,
    minHeight: 520,
    show: false,
    title: '内置插件选择向导',
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    ...(IS_WIN ? { frame: false, roundedCorners: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'assets', 'onboarding-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  wizardWindow = win;
  const session: BridgeSession = {
    id: String(win.webContents.id),
    send: (channel, payload) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
    },
    focus: () => { if (!win.isDestroyed()) win.focus(); },
    // 对齐原 closeWizard 的 destroy 收口（跳过 close 钩子直接销毁）。
    close: () => { if (!win.isDestroyed()) win.destroy(); },
    isAlive: () => !win.isDestroyed() && !win.webContents.isDestroyed(),
  };
  // onboard:list/submit/close 的来源校验据此比对会话 token（lib/ipc/onboard.ts）。
  state.wizardSession = session;
  void win.loadFile(path.join(__dirname, '..', 'assets', 'onboarding.html'));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  // 用户直接关窗（X/Alt+F4）＝取消：走 lib/onboarding.ts 的取消收口
  // （提交/跳过路径先经 closeWizard，wizardDone 已清空时此处为无害空转）。
  win.on('closed', () => {
    if (wizardWindow === win) wizardWindow = null;
    closeWizard({ ok: false, cancelled: true });
  });
  // mode 经 state.wizardMode 供 onboard:list 预填（rerun 带当前启停状态）。
  void mode;
  return true;
}

// ---------------------------------------------------------------------------
// 更新进度窗（移植自原 lib/update-flow.ts showUpdateWindow + 进度注入段）
// ---------------------------------------------------------------------------

function openUpdateProgress(opts: OpenUpdateProgressOpts): UpdateProgressHandle | null {
  const parent = getMainWindow();
  const win = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    ...(parent ? { parent } : {}),
    modal: true,
    title: '正在更新',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  void win.loadFile(path.join(__dirname, '..', 'assets', 'updating.html')).then(() => {
    void win.webContents
      .executeJavaScript(`window.__init && window.__init(${JSON.stringify({ version: opts.version, kind: opts.kind })})`)
      .catch(() => {});
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  // 进度节流（300ms）在 lib/update-flow.ts 的推送器侧完成；宿主只负责注入。
  return {
    setProgress: (p) => {
      if (win.isDestroyed()) return;
      void win.webContents
        .executeJavaScript(
          `window.__setProgress && window.__setProgress(${p.pct}, ${p.receivedMB ?? 0}, ${p.totalMB ?? 0}, ${JSON.stringify(p.meta ?? {})})`,
        )
        .catch(() => {});
    },
    close: () => {
      if (!win.isDestroyed()) win.close();
    },
  };
}

// ---------------------------------------------------------------------------
// HostWindows 装配（全部方法映射到模块内持有的窗口引用）
// ---------------------------------------------------------------------------

/** 主窗就绪后回调一次（已可见立即回调；主窗不存在时不回调——run-state 的
 *  备份清理确认等启动晚期弹窗用它避免抢焦点；语义＝原实现）。 */
function onMainReady(cb: () => void): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    cb();
    return;
  }
  mainWindow.once('ready-to-show', cb);
}

/** 统一的「重新加载」入口：处于恢复页（已放弃自动恢复）时走恢复流程
 *  retryNow，否则普通 reload。菜单与 Ctrl+R 共用。 */
function reloadMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const st = state.recovery ? state.recovery.stateOf(mainWindow) : null;
  if (st && st.gaveUp) {
    log('recovery', '用户在恢复页触发重新加载');
    state.recovery?.retryNow(mainWindow);
    return;
  }
  mainWindow.reload();
}

/** 渲染恢复机专用：销毁当前主窗并重建（登记新桥会话 + 挂恢复机）。 */
function rebuildMainWindowForRecovery(opts: { startHidden: boolean }): RecoveryWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  createMain({ startHidden: opts.startHidden });
  return mainWindow;
}

/** Electron 窗口宿主面（main.ts 装配段注入 initHostCtx）。 */
export function electronWindows(): HostWindows {
  return {
    createMain,
    loadMain: (url) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      return mainWindow.loadURL(url);
    },
    showMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); },
    hideMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); },
    focusMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus(); },
    restoreMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.restore(); },
    minimizeMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); },
    maximizeMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.maximize(); },
    unmaximizeMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.unmaximize(); },
    closeMain: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); },
    reloadMain,
    toggleDevTools: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
    },
    setMainFullScreen: (v) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(v);
    },
    isMainVisible: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
    isMainMinimized: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized(),
    isMainMaximized: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized(),
    isMainFullScreen: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen(),
    onMainReady,
    sendToMain: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    },
    openFloatWindow,
    closeFloatByToken,
    openRecoveryCenter,
    closeRecoveryCenter,
    openPluginWizard,
    openUpdateProgress,
    rebuildMainWindowForRecovery,
  };
}

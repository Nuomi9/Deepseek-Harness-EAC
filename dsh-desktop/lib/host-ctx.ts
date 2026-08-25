/**
 * lib/host-ctx.ts — 宿主上下文注入（Task 5.1；模板取 lib/desktop/guard-box.ts
 * 的 XxxCtx 单例注入 + runtime-paths.ts 的防御性缺省语义）。
 *
 * lib/* 统一模块不直接 import electron：Electron API 面（打包态/资源根/
 * 版本号/系统通知/剪贴板/退出/系统目录/无主窗消息框/.lnk 快捷方式读写）
 * 经本单例注入，双宿主过渡期同一份模块可运行于——
 *   · Electron main：main.ts 装配段 initHostCtx(electronHost())
 *   · Tauri sidecar：sidecar/server.ts 装配段 initHostCtx(sidecarHost())
 *   · Node 测试：initHostCtx(mock) 或直接用内置缺省（开发态语义）
 *
 * 未注入时按开发态缺省处理（对齐 lib/desktop/runtime-paths.ts 约定）：
 * isPackaged=false / resourcesPath='' / vendor 布局 / OS 惯例系统目录；
 * GUI 类能力（通知/剪贴板/消息框）缺省为静默或无头兜底，绝不抛错。
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { log as defaultLog } from './log.js';

/** 系统通知参数（Electron Notification 语义子集）。 */
export interface HostNotifyOpts {
  title: string;
  body: string;
  /** 通知图标绝对路径（可选）。 */
  icon?: string;
  /** 用户点击通知回调（可选）。 */
  onClick?(): void;
}

/** 无主窗消息框参数（Electron dialog.showMessageBox 语义子集）。 */
export interface HostMessageBoxOpts {
  type: 'error' | 'info' | 'warning' | 'none';
  title: string;
  message: string;
  detail?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
}

/** .lnk 写入参数（Electron shell.writeShortcutLink 语义子集）。 */
export interface HostShortcutWriteOpts {
  target: string;
  description?: string;
  icon?: string;
  iconIndex?: number;
  appUserModelId?: string;
}

/**
 * .lnk 读回结构（Electron shell.readShortcutLink 返回面的宽松描述；全可选
 * —— Electron ShortcutDetails 接口可直接结构化赋值，sidecar PowerShell 实现
 * 返回其子集）。
 */
export interface HostShortcutLink {
  target?: string;
  args?: string;
  cwd?: string;
  description?: string;
  icon?: string;
  iconIndex?: number;
  appUserModelId?: string;
}

/** Windows .lnk 快捷方式读写能力（宿主不支持则整体缺省 → 调用方跳过维护）。 */
export interface HostShortcuts {
  /** 读 .lnk；损坏/失败抛错（调用方自行捕获）。 */
  readLink(p: string): HostShortcutLink;
  /** 写 .lnk；失败抛错（调用方自行捕获）。 */
  writeLink(p: string, operation: 'create' | 'replace', opts: HostShortcutWriteOpts): void;
}

/**
 * 宿主接口：lib/* 模块的全部宿主依赖面。必选成员各宿主都能给出等价实现
 * （Node 缺省兜底见下方 NODE_DEFAULT）；可选成员是宿主专属能力，缺省时
 * 调用方按「能力不存在」静默降级。
 */
export interface HostCtx {
  /** 是否打包态（vendor ↔ resources 布局、看门狗/快捷方式维护等门控）。 */
  isPackaged(): boolean;
  /** 打包态资源根（resources/）；开发态为空串。 */
  resourcesPath(): string;
  /** 应用版本号（Electron app.getVersion / sidecar package.json）。 */
  appVersion(): string;
  /** 宿主日志通道（缺省路由到 lib/log.ts）。 */
  log(tag: string, msg: string): void;
  /** 立即终止进程，跳过优雅退出链（Electron app.exit / process.exit）。 */
  exitProcess(code: number): void;
  /** 请求宿主走优雅退出链（Electron app.quit；无优雅链宿主等价 exit(0)）。 */
  requestQuit(): void;
  /** 系统通知（无通知通道宿主静默，不抛错）。 */
  notify(opts: HostNotifyOpts): void;
  /** 复制文本到系统剪贴板（无剪贴板宿主静默，不抛错）。 */
  copyToClipboard(text: string): void;
  /** 系统目录（Electron app.getPath 语义；缺省按 OS 惯例）。 */
  getPath(name: 'appData' | 'desktop' | 'userData'): string;
  /** 启动早期重定向系统目录（Electron app.setPath('userData')；缺省记录覆盖）。 */
  setPath?(name: 'userData', value: string): void;
  /** 移除原生应用菜单（Electron 专属；缺省 no-op）。 */
  removeAppMenu?(): void;
  /** 无主窗消息框；缺省无头兜底（记日志并按 cancelId 应答）。 */
  showMessageBox(opts: HostMessageBoxOpts): Promise<{ response: number }>;
  /** Windows .lnk 快捷方式能力（缺省 undefined → 调用方跳过维护）。 */
  shortcuts?: HostShortcuts;
}

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/** OS 惯例 appData（对齐 Electron app.getPath('appData') 的落点）。 */
function defaultAppData(): string {
  if (IS_WIN) return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/** 缺省 setPath 的目录覆盖表（Electron 宿主的 setPath 影响后续 getPath）。 */
const defaultPathOverrides: Partial<Record<'appData' | 'desktop' | 'userData', string>> = {};

const NODE_DEFAULT: HostCtx = {
  isPackaged: () => false,
  resourcesPath: () => '',
  appVersion: () => '0.0.0',
  log: defaultLog,
  exitProcess: (code) => process.exit(code),
  requestQuit: () => process.exit(0),
  notify: () => { /* 无通知通道：静默（调用方本就不依赖通知成功） */ },
  copyToClipboard: () => { /* 无剪贴板通道：静默 */ },
  getPath: (name) => {
    const ov = defaultPathOverrides[name];
    if (ov) return ov;
    if (name === 'appData') return defaultAppData();
    if (name === 'desktop') return path.join(os.homedir(), 'Desktop');
    return path.join(defaultAppData(), 'Deepseek Harness EAC');
  },
  setPath: (name, value) => {
    defaultPathOverrides[name] = value;
  },
  removeAppMenu: () => { /* 无原生菜单概念：no-op */ },
  showMessageBox: (opts) => {
    // 无头兜底：消息内容走日志通道可追溯；应答取 cancelId（语义＝用户取消/
    // 关闭），让 fatal 等调用方按「无 GUI 环境的保守选择」走退出路径。
    defaultLog('dialog', `[headless] ${opts.title}: ${opts.message}${opts.detail ? ' — ' + opts.detail : ''}`);
    return Promise.resolve({ response: opts.cancelId ?? opts.buttons.length - 1 });
  },
};

let current: HostCtx = NODE_DEFAULT;

/** 注入宿主实现（Electron main / Tauri sidecar / 测试 mock 各自装配）。 */
export function initHostCtx(d: HostCtx): void {
  current = d;
}

/** 恢复内置缺省（测试 teardown 用）。 */
export function resetHostCtx(): void {
  current = NODE_DEFAULT;
  for (const k of Object.keys(defaultPathOverrides) as Array<'appData' | 'desktop' | 'userData'>) {
    delete defaultPathOverrides[k];
  }
}

/** 取当前宿主上下文（未注入时为开发态缺省）。 */
export function hostCtx(): HostCtx {
  return current;
}

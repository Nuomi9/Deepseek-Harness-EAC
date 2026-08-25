// src/i18n.ts — 动态文案字典
// 规则：VS Code 显示语言（vscode.env.language）以 zh- 开头 → 简体中文；
//       其余任何语言 → 英文。静态文案（package.nls.*.json）由 VS Code 自行处理，
//       本模块只负责运行时动态文案（状态栏、占位页、错误提示、日志等）。
const messages = {
  en: {
    // 面板占位页
    'panel.loading': 'Starting DSH service…',
    'panel.errorTitle': 'Failed to start DSH service',
    'panel.disconnectedTitle': 'DSH service disconnected',
    'panel.reconnect': 'Reconnect',
    'panel.retry': 'Retry',
    'panel.openExternal': 'Open in Browser',
    'panel.restart': 'Restart Service',
    'panel.stop': 'Stop Service',
    'panel.copyUrl': 'Copy URL',
    'panel.showLogs': 'Show Logs',
    'panel.openSettings': 'Open Settings',
    'panel.syncPlugins': 'Sync Built-in Plugins',
    'panel.openProfile': 'Open Profile Folder',
    'panel.openDshHome': 'Open DSH Home',
    // 错误原因
    'err.runtimeNotFound': 'Bundled Node runtime not found: {path}. Run "npm run fetch-runtime" in the repository root, then reload VS Code.',
    'err.dshNotFound': 'Bundled dsh CLI not found: {path}. Run "npm install" in the repository root, then reload VS Code.',
    'err.profileNotReady': 'DSH profile is not initialized.',
    'err.startTimeout': 'Service did not become ready within {seconds}s. See the DSH log for details.',
    'err.startCrashed': 'The DSH service exited unexpectedly. See the DSH log for details.',
    'err.notRunning': 'DSH service is not running and auto-start is disabled.',
    'err.loadFailed': 'Unable to load the DSH page.',
    'err.syncFailed': 'Built-in plugin sync failed: {message}',
    // 状态栏
    'status.running': 'DSH EAC: Running',
    'status.starting': 'DSH EAC: Starting',
    'status.failed': 'DSH EAC: Failed',
    'status.stopped': 'DSH EAC: Stopped',
    // 通知
    'info.urlCopied': 'URL copied: {url}',
    'info.notReady': 'DSH service is not ready yet.',
    'info.stopped': 'DSH service stopped.',
    'info.pluginsSynced': 'Built-in plugins synced: {count} entries registered.',
    'info.portChanged': 'DSH service is running on port {port}.',
    'msg.logsCopied': 'DSH logs copied to the clipboard. Paste them into your bug report.',
  },
  zh: {
    'panel.loading': '正在启动 DSH 服务…',
    'panel.errorTitle': 'DSH 服务启动失败',
    'panel.disconnectedTitle': 'DSH 服务已断开',
    'panel.reconnect': '重新连接',
    'panel.retry': '重试',
    'panel.openExternal': '在浏览器中打开',
    'panel.restart': '重启服务',
    'panel.stop': '停止服务',
    'panel.copyUrl': '复制网址',
    'panel.showLogs': '查看日志',
    'panel.openSettings': '打开设置',
    'panel.syncPlugins': '同步内置插件',
    'panel.openProfile': '打开 Profile 目录',
    'panel.openDshHome': '打开 DSH_HOME 目录',
    'err.runtimeNotFound': '未找到内置 Node 运行时：{path}。请在仓库根目录运行 "npm run fetch-runtime" 后重载窗口。',
    'err.dshNotFound': '未找到内置 dsh CLI：{path}。请在仓库根目录运行 "npm install" 后重载窗口。',
    'err.profileNotReady': 'DSH profile 未初始化。',
    'err.startTimeout': '服务在 {seconds} 秒内未就绪，详见 DSH 日志。',
    'err.startCrashed': 'DSH 服务异常退出，详见 DSH 日志。',
    'err.notRunning': 'DSH 服务未运行，且已关闭自动启动。',
    'err.loadFailed': '无法加载 DSH 页面。',
    'err.syncFailed': '内置插件同步失败：{message}',
    'status.running': 'DSH EAC: 运行中',
    'status.starting': 'DSH EAC: 启动中',
    'status.failed': 'DSH EAC: 失败',
    'status.stopped': 'DSH EAC: 已停止',
    'info.urlCopied': '已复制网址：{url}',
    'info.notReady': 'DSH 服务尚未就绪。',
    'info.stopped': 'DSH 服务已停止。',
    'info.pluginsSynced': '内置插件同步完成：已注册 {count} 个条目。',
    'info.portChanged': 'DSH 服务运行在端口 {port}。',
    'msg.logsCopied': 'DSH 日志已复制到剪贴板，请粘贴到问题报告中。',
  },
} as const;

/** 文案键联合类型（en 为键的来源） */
export type MsgKey = keyof typeof messages.en;

let current: 'zh' | 'en' = 'en';

/** 按语言规则初始化（扩展激活时调用一次） */
export function initI18n(language: string): void {
  current = language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 当前语言 */
export function getLang(): 'zh' | 'en' {
  return current;
}

/** 取文案；vars 中的 {key} 会被替换 */
export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  let s: string = messages[current][key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

// src/panel/html.ts — 面板占位页 HTML 模板（loading / ready / error / disconnected / stopped）
// 纯模块：不依赖 vscode；文案经 t() 注入，便于单测。
import type { MsgKey } from '../i18n';

/** 页面渲染上下文 */
export interface PageCtx {
  /** CSP 随机 nonce（放行内联脚本） */
  nonce: string;
  /** webview.cspSource */
  cspSource: string;
  /** 允许 iframe 加载的源（frame-src CSP 放行） */
  frameHosts: string[];
}

/** 面板内按钮消息（webview → 扩展宿主） */
export type PanelMessage =
  | { type: 'retry' }
  | { type: 'reconnect' }
  | { type: 'restart' }
  | { type: 'stop' }
  | { type: 'openExternal' }
  | { type: 'copyUrl' }
  | { type: 'showLogs' }
  | { type: 'syncPlugins' }
  | { type: 'openProfile' }
  | { type: 'openDshHome' }
  | { type: 'openSettings' };

/** 页面骨架（CSP + 样式 + 消息转发） */
function shell(
  ctx: PageCtx,
  inner: string,
  extraScript = '',
): string {
  const frameSrc = ctx.frameHosts.join(' ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${ctx.cspSource} 'unsafe-inline'; script-src 'nonce-${ctx.nonce}'; frame-src ${frameSrc}; img-src ${ctx.cspSource} data:;">
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); margin: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
  .frame-wrap { position: absolute; inset: 0; }
  iframe { width: 100%; height: 100%; border: none; background: #fff; }
  h2 { margin: 0; font-weight: 500; }
  p { margin: 0; opacity: 0.8; text-align: center; padding: 0 16px; }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; padding: 0 16px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .spin { width: 28px; height: 28px; border: 3px solid var(--vscode-editorWidget-border); border-top-color: var(--vscode-focusBorder); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
${inner}
<script nonce="${ctx.nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  function send(type) { vscode.postMessage({ type }); }
  document.querySelectorAll('[data-action]').forEach(function (el) {
    el.addEventListener('click', function () { send(el.getAttribute('data-action')); });
  });
  ${extraScript}
})();
</script>
</body>
</html>`;
}

/** 加载中页面 */
export function loadingPage(t: (k: MsgKey) => string, ctx: PageCtx): string {
  return shell(
    ctx,
    `<div class="spin"></div><p>${t('panel.loading')}</p>`,
  );
}

/** 就绪页面：iframe 嵌入 DSH web UI */
export function readyPage(
  url: string,
  ctx: PageCtx,
): string {
  return shell(
    ctx,
    `<div class="frame-wrap"><iframe src="${url}" allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe></div>`,
  );
}

/** 失败页面 */
export function errorPage(t: (k: MsgKey, vars?: Record<string, string | number>) => string, ctx: PageCtx, message: string): string {
  return shell(
    ctx,
    `<h2>${t('panel.errorTitle')}</h2><p>${message}</p>
     <div class="btn-row">
       <button data-action="retry">${t('panel.retry')}</button>
       <button data-action="showLogs">${t('panel.showLogs')}</button>
       <button data-action="openSettings">${t('panel.openSettings')}</button>
     </div>`,
  );
}

/** 服务断开页面（曾就绪后失联） */
export function disconnectedPage(t: (k: MsgKey) => string, ctx: PageCtx): string {
  return shell(
    ctx,
    `<h2>${t('panel.disconnectedTitle')}</h2>
     <div class="btn-row">
       <button data-action="reconnect">${t('panel.reconnect')}</button>
       <button data-action="showLogs">${t('panel.showLogs')}</button>
     </div>`,
  );
}

/** 手动停止页面 */
export function stoppedPage(t: (k: MsgKey) => string, ctx: PageCtx): string {
  return shell(
    ctx,
    `<p>${t('status.stopped')}</p>
     <div class="btn-row">
       <button data-action="retry">${t('panel.reconnect')}</button>
     </div>`,
  );
}

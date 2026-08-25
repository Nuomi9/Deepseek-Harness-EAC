// src/panel/provider.ts — 侧边栏面板：iframe 与占位页切换
import * as vscode from 'vscode';
import { ServiceManager } from '../service/manager';
import { t } from '../i18n';
import { loadingPage, errorPage, disconnectedPage, stoppedPage, readyPage, type PanelMessage, type PageCtx } from './html';

export class DshPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  /** 曾处于 ready：用于区分"服务断开"与"手动停止"两种占位页 */
  private wasConnected = false;
  /** 面板是否已首次打开过（用于一次性回调） */
  private openedOnce = false;

  constructor(
    private manager: ServiceManager,
    private onFirstOpen?: () => void,
  ) {
    // 订阅状态变化，重绘面板（iframe 与占位页由状态驱动，无白屏路径）
    manager.onChange(() => this.render());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg: PanelMessage) => this.onMessage(msg));
    if (!this.openedOnce) {
      this.openedOnce = true;
      this.onFirstOpen?.();
    }
    this.render();
    // 面板打开即确保服务运行：复用已有或自动启动
    void this.manager.ensureRunning();
  }

  /** 处理面板内按钮消息（全部转交给 manager 或对应命令） */
  private onMessage(msg: PanelMessage): void {
    switch (msg.type) {
      case 'retry':
      case 'reconnect':
        void this.manager.ensureRunning();
        break;
      case 'restart':
        void this.manager.restart();
        break;
      case 'stop':
        this.wasConnected = false;
        void this.manager.stop();
        break;
      case 'openExternal':
        void vscode.commands.executeCommand('dshEac.openExternal');
        break;
      case 'copyUrl':
        void vscode.commands.executeCommand('dshEac.copyUrl');
        break;
      case 'showLogs':
        void vscode.commands.executeCommand('dshEac.showLogs');
        break;
      case 'syncPlugins':
        void vscode.commands.executeCommand('dshEac.syncPlugins');
        break;
      case 'openProfile':
        void vscode.commands.executeCommand('dshEac.openProfile');
        break;
      case 'openDshHome':
        void vscode.commands.executeCommand('dshEac.openDshHome');
        break;
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', 'dshEac');
        break;
    }
  }

  /** 按服务状态渲染对应页面 */
  private render(): void {
    const v = this.view;
    if (!v) return;
    const nonce = Math.random().toString(36).slice(2);
    const { host, port } = this.manager.getTarget();
    const ctx: PageCtx = { nonce, cspSource: v.webview.cspSource, frameHosts: [`http://${host}:${port}`] };
    const s = this.manager.getSnapshot();
    let html: string;
    switch (s.state) {
      case 'ready':
        this.wasConnected = true;
        html = readyPage(s.url ?? `http://${host}:${port}/`, ctx);
        break;
      case 'failed':
        html = errorPage(t, ctx, s.error ? t(s.error, s.errorVars) : t('err.loadFailed'));
        break;
      case 'idle':
        html = this.wasConnected ? disconnectedPage(t, ctx) : stoppedPage(t, ctx);
        break;
      default:
        // detecting / starting / stopping：统一加载中动画页
        html = loadingPage(t, ctx);
    }
    v.webview.html = html;
  }
}

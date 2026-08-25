// test/html.test.ts — 面板 HTML 模板测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadingPage, readyPage, errorPage, disconnectedPage, stoppedPage, type PageCtx } from '../src/panel/html';
import { t } from '../src/i18n';

const ctx: PageCtx = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://abc',
  frameHosts: ['http://127.0.0.1:3080'],
};

test('loadingPage 包含加载文案与 CSP nonce', () => {
  const html = loadingPage(t, ctx);
  assert.ok(html.includes(t('panel.loading')));
  assert.ok(html.includes('nonce-abc123'));
});

test('readyPage iframe 指向服务 URL，且 CSP frame-src 放行该源', () => {
  const html = readyPage('http://127.0.0.1:3080/', ctx);
  assert.ok(html.includes('src="http://127.0.0.1:3080/"'));
  assert.ok(html.includes('frame-src http://127.0.0.1:3080'));
});

test('errorPage 显示错误消息与重试按钮', () => {
  const html = errorPage(t, ctx, 'something went wrong');
  assert.ok(html.includes(t('panel.errorTitle')));
  assert.ok(html.includes('something went wrong'));
  assert.ok(html.includes('data-action="retry"'));
  assert.ok(html.includes('data-action="showLogs"'));
});

test('disconnectedPage 提供重连按钮', () => {
  const html = disconnectedPage(t, ctx);
  assert.ok(html.includes(t('panel.disconnectedTitle')));
  assert.ok(html.includes('data-action="reconnect"'));
});

test('stoppedPage 提供重新连接按钮', () => {
  const html = stoppedPage(t, ctx);
  assert.ok(html.includes('data-action="retry"'));
});

test('iframe sandbox 允许脚本/同源/表单/弹窗（DSH Web UI 所需）', () => {
  const html = readyPage('http://127.0.0.1:3080/', ctx);
  const m = html.match(/<iframe[^>]*sandbox="([^"]*)"/);
  assert.ok(m);
  for (const token of ['allow-scripts', 'allow-same-origin', 'allow-forms']) {
    assert.ok(m![1].includes(token), `sandbox 缺少 ${token}`);
  }
});

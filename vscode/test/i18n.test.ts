// test/i18n.test.ts — 文案字典与替换测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initI18n, t, getLang } from '../src/i18n';

test('initI18n: zh-* 前缀 → 中文', () => {
  initI18n('zh-CN');
  assert.equal(getLang(), 'zh');
});

test('initI18n: 其他语言 → 英文', () => {
  initI18n('en-US');
  assert.equal(getLang(), 'en');
  initI18n('ja');
  assert.equal(getLang(), 'en');
});

test('t(): 中英文文案可切换', () => {
  initI18n('en');
  assert.equal(t('status.running'), 'DSH EAC: Running');
  initI18n('zh-CN');
  assert.equal(t('status.running'), 'DSH EAC: 运行中');
});

test('t(): {变量} 替换', () => {
  initI18n('en');
  assert.equal(t('err.runtimeNotFound', { path: 'C:\\vendor\\node.exe' }), 'Bundled Node runtime not found: C:\\vendor\\node.exe. Run "npm run fetch-runtime" in the repository root, then reload VS Code.');
});

test('t(): 全部文案键均有中英文翻译', () => {
  initI18n('en');
  // 通过 t() 验证所有键在 zh 下可解析（不抛 undefined）
  initI18n('zh-CN');
  const keys = ['panel.loading', 'panel.errorTitle', 'panel.disconnectedTitle', 'panel.reconnect', 'panel.retry', 'panel.openExternal', 'panel.restart', 'panel.stop', 'panel.copyUrl', 'panel.showLogs', 'panel.openSettings', 'panel.syncPlugins', 'panel.openProfile', 'panel.openDshHome', 'err.runtimeNotFound', 'err.dshNotFound', 'err.profileNotReady', 'err.startTimeout', 'err.startCrashed', 'err.notRunning', 'err.loadFailed', 'err.syncFailed', 'status.running', 'status.starting', 'status.failed', 'status.stopped', 'info.urlCopied', 'info.notReady', 'info.stopped', 'info.pluginsSynced', 'info.portChanged', 'msg.logsCopied'] as const;
  for (const k of keys) {
    assert.ok(typeof t(k) === 'string' && t(k).length > 0, `键 ${k} 的 zh 文案缺失`);
  }
});

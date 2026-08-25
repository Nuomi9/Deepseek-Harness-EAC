// test/config.test.ts — normalizeConfig 纯函数测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULTS } from '../src/config';

test('缺省配置回退默认值', () => {
  const { config, errors } = normalizeConfig({});
  assert.deepEqual(config, DEFAULTS);
  assert.deepEqual(errors, []);
});

test('合法配置原样通过', () => {
  const { config, errors } = normalizeConfig({
    port: 3080,
    autoStart: false,
    stopOnExit: false,
    profile: 'web',
    dshHome: 'C:\\custom\\dsh',
    syncBuiltinPlugins: false,
    extraArgs: ['--foo', 'bar'],
    patchOverlays: ['C:\\patch.yml'],
    openInBrowser: true,
    workspaceRootIndex: 1,
  });
  assert.equal(config.port, 3080);
  assert.equal(config.profile, 'web');
  assert.equal(config.dshHome, 'C:\\custom\\dsh');
  assert.equal(config.syncBuiltinPlugins, false);
  assert.deepEqual(config.extraArgs, ['--foo', 'bar']);
  assert.deepEqual(config.patchOverlays, ['C:\\patch.yml']);
  assert.equal(config.openInBrowser, true);
  assert.equal(config.workspaceRootIndex, 1);
  assert.deepEqual(errors, []);
});

test('非法端口回退默认并记录错误', () => {
  const { config, errors } = normalizeConfig({ port: -1 });
  assert.equal(config.port, DEFAULTS.port);
  assert.ok(errors.some((e) => e.includes('dshEac.port')));
});

test('非法 profile 回退默认并记录错误', () => {
  const { config, errors } = normalizeConfig({ profile: 'nope' });
  assert.equal(config.profile, DEFAULTS.profile);
  assert.ok(errors.some((e) => e.includes('dshEac.profile')));
});

test('非法 workspaceRootIndex 回退默认并记录错误', () => {
  const { config, errors } = normalizeConfig({ workspaceRootIndex: -3 });
  assert.equal(config.workspaceRootIndex, DEFAULTS.workspaceRootIndex);
  assert.ok(errors.some((e) => e.includes('dshEac.workspaceRootIndex')));
});

test('非字符串 dshHome 静默回退空串（不记错误）', () => {
  const { config, errors } = normalizeConfig({ dshHome: 123 as unknown as string });
  assert.equal(config.dshHome, '');
  assert.deepEqual(errors, []);
});

test('extraArgs 过滤非字符串项', () => {
  const { config } = normalizeConfig({ extraArgs: ['ok', 42 as unknown as string, 'also'] });
  assert.deepEqual(config.extraArgs, ['ok', 'also']);
});

test('host 固定为回环地址（安全边界）', () => {
  const { config } = normalizeConfig({});
  assert.equal(config.host, '127.0.0.1');
});

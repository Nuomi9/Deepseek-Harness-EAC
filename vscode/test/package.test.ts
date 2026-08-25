// test/package.test.ts — package.json 元数据完整性测试（插件可被 VS Code 正确加载的前提）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

test('package.json 关键字段齐全', () => {
  assert.equal(typeof pkg.name, 'string');
  assert.equal(typeof pkg.version, 'string');
  assert.equal(typeof pkg.publisher, 'string');
  assert.equal(typeof pkg.main, 'string');
  assert.ok(pkg.main.endsWith('extension.js'));
  assert.ok(pkg.engines.vscode);
  assert.ok(pkg.activationEvents.length > 0);
  assert.ok(pkg.contributes);
});

test('main 指向的入口在构建后会存在（由 out/extension.js 提供）', () => {
  assert.equal(pkg.main, './out/extension.js');
});

test('activationEvents 覆盖所有命令', () => {
  const commands = Object.keys(pkg.contributes.commands ?? {}).map(() => 'x');
  void commands;
  for (const cmd of Object.values(pkg.contributes.commands) as { command: string }[]) {
    assert.ok(
      pkg.activationEvents.includes(`onCommand:${cmd.command}`),
      `activationEvents 缺少 onCommand:${cmd.command}`,
    );
  }
});

test('视图容器与视图 id 对应', () => {
  const containers = pkg.contributes.viewsContainers.activitybar.map((c: { id: string }) => c.id);
  for (const c of containers) {
    assert.ok(pkg.contributes.views[c], `views 缺少容器 ${c}`);
  }
});

test('配置项均有默认值', () => {
  const props = pkg.contributes.configuration.properties;
  for (const [key, v] of Object.entries(props) as [string, { default?: unknown }][]) {
    assert.ok('default' in v, `配置项 ${key} 缺少 default`);
  }
});

test('README 存在', () => {
  assert.ok(readFileSync(join(process.cwd(), 'README.md'), 'utf8').length > 100);
});

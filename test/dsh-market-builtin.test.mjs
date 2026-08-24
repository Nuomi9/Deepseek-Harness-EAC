import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// 内置 dsh-market（github.com/dsh-market/dsh-market）作为第三个插件市场入口：
// 与既有 dsh-webui-market / dsh-plugin-marketplace 并存，互不接管。
test('assets/plugins/dsh-market 是合法 dshmarket 包（含预编译产物）', () => {
  const pkg = JSON.parse(read('assets/plugins/dsh-market/package.json'));
  assert.equal(pkg.name, 'dshmarket');
  assert.equal(pkg.license, 'MIT');
  // bundle patch 声明与文件都必须真实存在（激活链路依赖它）
  const patchRel = pkg.dsh?.bundle?.patch;
  assert.ok(typeof patchRel === 'string', '必须声明 dsh.bundle.patch');
  assert.ok(existsSync(join(root, 'assets/plugins/dsh-market', patchRel)), 'cordis.patch.yml 缺失');
  // 入口文件真实存在（不许只有声明）
  if (typeof pkg.main === 'string') {
    assert.ok(existsSync(join(root, 'assets/plugins/dsh-market', pkg.main)), 'main 入口缺失');
  }
  assert.ok(existsSync(join(root, 'assets/plugins/dsh-market', 'LICENSE')), 'LICENSE 缺失');
});

test('main.js 注册 dsh-market 配套插件并登记上游更新源', () => {
  const main = read('main.js');
  assert.match(main, /\{ id: 'dsh-market', name: 'dshmarket', dir: 'dsh-market' \}/);
  assert.match(main, /'dsh-market': \{ npm: 'dshmarket' \}/);
});

test('desktop-core.js companion 清单同步注册（Tauri parity）', () => {
  const core = read('desktop-core.js');
  assert.match(core, /\{ id: 'dsh-market', name: 'dshmarket', dir: 'dsh-market' \}/);
});

test('v4Lite 清单测试已把 dsh-market 纳入目标状态', () => {
  const t = read('test/lite-manifest.test.mjs');
  assert.ok(t.includes("'dsh-market'"), 'KEEP_PLUGIN_DIRS/IDS 必须包含 dsh-market');
});

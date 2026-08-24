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

test('desktop-core.js companion 清单同步注册（Electron parity）', () => {
  const core = read('desktop-core.js');
  assert.match(core, /\{ id: 'dsh-market', name: 'dshmarket', dir: 'dsh-market' \}/);
  assert.match(core, /'dsh-market': \{ npm: 'dshmarket' \}/);
});

// Tauri 发布轨真正随包分发的是 sidecar TS 源码 + 编译产物（sidecar/dist），
// 4.5.0 事故：dsh-market 只登记进了 Electron 的 desktop-core.js/main.js，
// sidecar 漏登记导致真机安装后没有插件市场。这里钉死两侧一致。
test('sidecar TS 源码 companion 清单注册 dsh-market（随包发布路径）', () => {
  const ts = read('sidecar/src/desktop-core.ts');
  assert.match(ts, /\{ id: 'dsh-market', name: 'dshmarket', dir: 'dsh-market' \}/);
  assert.match(ts, /'dsh-market': \{ npm: 'dshmarket' \}/);
});

test('sidecar 编译产物（sidecar/dist）同步注册 dsh-market（真机运行的就是它）', () => {
  const dist = read('sidecar/dist/desktop-core.js');
  assert.match(dist, /\{ id: 'dsh-market', name: 'dshmarket', dir: 'dsh-market' \}/);
  assert.match(dist, /'dsh-market': \{ npm: 'dshmarket' \}/);
});

// 4.6.0 真机事故：dshmarket 服务端 lib/net.js 顶层 import undici，但包里没
// vendor、内核闭包也不含 undici（js-yaml 在内核闭包）→ 全新装机插件树加载
// 失败、dsh web 退出 code=1、窗口 ERR_CONNECTION_REFUSED。运行时依赖必须
// 随包 vendored（copyPluginPackage 拷贝嵌套 node_modules）。
test('dsh-market 自带 vendored 运行时依赖（undici，全新装机离线可用）', () => {
  const undici = JSON.parse(read('assets/plugins/dsh-market/node_modules/undici/package.json'));
  assert.ok(undici.version.startsWith('7.'), 'undici 版本应满足 dsh-market 的 ^7.29.0 声明，实际 ' + undici.version);
  assert.ok(existsSync(join(root, 'assets/plugins/dsh-market/node_modules/undici/index.js')), 'undici 入口缺失');
});

test('v4Lite 清单测试已把 dsh-market 纳入目标状态', () => {
  const t = read('test/lite-manifest.test.mjs');
  assert.ok(t.includes("'dsh-market'"), 'KEEP_PLUGIN_DIRS/IDS 必须包含 dsh-market');
});

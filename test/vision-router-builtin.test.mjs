import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const vr = (rel) => join(root, 'assets/plugins/dsh-vision-router', rel);

// 内置 vision router（github.com/ysr666/dsh-vision-router）：纯文本代理的视觉
// 链路 + 像素级视觉工具。入口是根级 entry.js（main 字段），随包自包含
// vendored node_modules —— 这两点正是 copyPluginPackage 拷贝清单的补充项。
test('assets/plugins/dsh-vision-router 是合法 dsh-vision-router 包', () => {
  const pkg = JSON.parse(read('assets/plugins/dsh-vision-router/package.json'));
  assert.equal(pkg.name, 'dsh-vision-router');
  assert.equal(pkg.license, 'MIT');
  // 版本钉为内置分发时的上游版本（升级走 plugin-updater 的 GitHub 源）。
  assert.equal(pkg.version, '1.7.7');
  // main 是根级 entry.js（不是 lib/index.js），拷贝清单必须覆盖它。
  assert.equal(pkg.main, 'entry.js');
  assert.ok(existsSync(vr('entry.js')), 'entry.js 缺失');
  assert.ok(existsSync(vr('index.js')), 'index.js 缺失');
  assert.ok(existsSync(vr('cordis.patch.yml')), 'cordis.patch.yml 缺失');
  assert.ok(existsSync(vr('LICENSE')), 'LICENSE 缺失');
});

test('vision router 自带 vendored 运行时依赖（自包含，不依赖网络安装）', () => {
  const vendored = ['undici', 'potrace', 'puppeteer-core', '@puppeteer/browsers', 'chromium-bidi', 'devtools-protocol', 'typed-query-selector', 'webdriver-bidi-protocol'];
  for (const name of vendored) {
    const pkg = join(vr('node_modules'), ...name.split('/'), 'package.json');
    assert.ok(existsSync(pkg), '缺失 vendored 依赖: ' + name);
    const meta = JSON.parse(readFileSync(pkg, 'utf8'));
    assert.ok(typeof meta.version === 'string' && meta.version.length > 0, name + ' 缺版本号');
  }
});

test('provider 预设与文档随包拷贝（presets/docs 目录）', () => {
  for (const rel of ['presets/README.md', 'presets/openrouter.yaml', 'docs/doctor.md']) {
    assert.ok(existsSync(vr(rel)), rel + ' 缺失');
  }
});

test('main.js 注册 vision-router 配套插件并登记 GitHub 更新源', () => {
  const main = read('main.js');
  assert.match(main, /\{ id: 'vision-router', name: 'dsh-vision-router', dir: 'dsh-vision-router' \}/);
  assert.match(main, /'vision-router': \{ github: 'ysr666\/dsh-vision-router' \}/);
});

test('desktop-core.js companion 清单同步注册（Electron parity）', () => {
  const core = read('desktop-core.js');
  assert.match(core, /\{ id: 'vision-router', name: 'dsh-vision-router', dir: 'dsh-vision-router' \}/);
  assert.match(core, /'vision-router': \{ github: 'ysr666\/dsh-vision-router' \}/);
});

test('sidecar TS 源码 + 编译产物同步注册（Tauri 随包发布路径）', () => {
  const ts = read('sidecar/src/desktop-core.ts');
  assert.match(ts, /\{ id: 'vision-router', name: 'dsh-vision-router', dir: 'dsh-vision-router' \}/);
  assert.match(ts, /'vision-router': \{ github: 'ysr666\/dsh-vision-router' \}/);
  const dist = read('sidecar/dist/desktop-core.js');
  assert.match(dist, /\{ id: 'vision-router', name: 'dsh-vision-router', dir: 'dsh-vision-router' \}/);
  assert.match(dist, /'vision-router': \{ github: 'ysr666\/dsh-vision-router' \}/);
});

test('拷贝清单覆盖根级 entry.js 与 presets/docs 目录（三处实现一致）', () => {
  for (const rel of ['main.js', 'desktop-core.js', 'sidecar/src/desktop-core.ts']) {
    const src = read(rel);
    assert.match(src, /\['entry\.js', 'index\.js'/, rel + ' 拷贝清单必须含根级 entry.js');
    // pluginCopyEntries 一行式 + copyPluginPackage 逐行式两种形态都要覆盖。
    assert.match(src, /'client', 'presets', 'docs'/, rel + ' pluginCopyEntries 必须含 presets/docs');
    assert.match(src, /copyDir\('presets'\);\s*\r?\n\s*copyDir\('docs'\)/, rel + ' copyPluginPackage 必须含 presets/docs');
  }
});

test('v4Lite 清单测试已把 vision-router 纳入目标状态', () => {
  const t = read('test/lite-manifest.test.mjs');
  assert.ok(t.includes("'dsh-vision-router'"), 'KEEP_PLUGIN_DIRS 必须包含 dsh-vision-router');
  assert.ok(t.includes("'vision-router'"), 'KEEP_PLUGIN_IDS 必须包含 vision-router');
});

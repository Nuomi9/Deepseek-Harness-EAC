// 叶子模块移植单测：plugin-manager-state / builtin-collision / profile-module-heal。
// 用可擦除 TS 语法（无 enum/namespace），node --test 原生 strip-types 直跑。
// 断言移植自旧 JS 套件的回归关键用例。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

// 指向编译产物（与生产运行物一致）；先 npm run sidecar:build 再跑测试。
import { collectPluginRows } from '../dist/lib/plugin-manager-state.js';
import { removeMarketDuplicate, stripPatchRows } from '../dist/lib/builtin-collision.js';
import { healProfileModuleShadowing } from '../dist/lib/profile-module-heal.js';

// ---------------------------------------------------------------------------
// plugin-manager-state.collectPluginRows
// ---------------------------------------------------------------------------

test('rows: companion → other → core 排序 + id 字典序', () => {
  const rows = collectPluginRows(
    [{ id: 'z-other', name: '@s/z-other' }],
    { companion: [{ id: 'b', name: 'pkg-b' }, { id: 'a', name: 'pkg-a' }], bundles: ['@x/core-b', '@x/core-a'] },
  );
  assert.deepEqual(rows.map((r) => r.group), ['companion', 'companion', 'other', 'core', 'core']);
  assert.deepEqual(rows.filter((r) => r.group === 'core').map((r) => r.id), ['core-a', 'core-b']);
});

test('rows: 顶层与 insert 内层任一 disabled 即禁用；hasConfig 只读顶层', () => {
  const rows = collectPluginRows([
    { insert: [{ id: 'pet', name: 'dsh-pet', disabled: true, config: { a: 1 } }] },
    { id: 'plain', name: 'dsh-plain', config: { b: 2 } },
    { id: 'both-off', name: 'dsh-both-off', disabled: true },
  ], { companion: [] });
  const pet = rows.find((r) => r.id === 'pet');
  assert.ok(pet);
  assert.equal(pet.enabled, false, 'insert 内层 disabled 即禁用');
  assert.equal(pet.toggleable, true, 'insert 内层 config 不锁开关');
  const plain = rows.find((r) => r.id === 'plain');
  assert.ok(plain);
  assert.equal(plain.toggleable, false, '顶层 config 且未禁用 → 锁开关');
});

test('rows: removed 插件不可切换不可移除；bundles 行归 core 组不可移除', () => {
  const rows = collectPluginRows([], {
    companion: [{ id: 'balance', name: '@deepseek-ai/dsh-balance' }],
    removedIds: ['balance'],
    coreIds: ['pm'],
    bundles: ['@x/pm'],
  });
  const bal = rows.find((r) => r.id === 'balance');
  assert.ok(bal);
  assert.equal(bal.removed, true);
  assert.equal(bal.removable, false);
  const pm = rows.find((r) => r.id === 'pm');
  assert.ok(pm);
  assert.equal(pm.group, 'core');
  // 原语义：bundles 派生行的 core 标志为 false（extra 只在 companion 循环传入），
  // 但 group='core' 已使其不可移除、不可切换。
  assert.equal(pm.core, false);
  assert.equal(pm.removable, false);
  assert.equal(pm.toggleable, false);
});

// ---------------------------------------------------------------------------
// builtin-collision
// ---------------------------------------------------------------------------

test('stripPatchRows：顶层与 insert 内层都按 id/name 移除并压紧空行', () => {
  const patch = [
    '- insert:',
    '  - id: balance',
    "    name: '@deepseek-ai/dsh-balance'",
    '    disabled: true',
    '- id: tool-vision',
    "  name: dsh-tool-vision",
    '- id: keeper',
    "  name: dsh-keeper",
    '',
  ].join('\n');
  const r1 = stripPatchRows(patch, '@deepseek-ai/dsh-balance', 'balance');
  assert.deepEqual(r1.removed, ['balance']);
  assert.ok(!r1.patch.includes('balance'));
  assert.ok(r1.patch.includes('keeper'));
  const r2 = stripPatchRows(r1.patch, 'dsh-tool-vision', 'tool-vision');
  assert.deepEqual(r2.removed, ['tool-vision']);
  assert.ok(r2.patch.includes('keeper'));
  assert.ok(!/\n{3,}/.test(r2.patch));
});

function makeTmpProfile(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vt-collision-'));
}

test('removeMarketDuplicate：清市场依赖与 bundle、保留 link:/file: 本地链接', () => {
  const dir = makeTmpProfile();
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: {
        'dsh-tool-vision': '^1.0.0',
        'my-fork': 'link:D:\\dev\\my-fork',
      },
      dsh: { profile: { bundles: ['dsh-tool-vision'] } },
    }));
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '- id: tool-vision\n  name: dsh-tool-vision\n');
    const logs: string[] = [];
    const r = removeMarketDuplicate(dir, 'dsh-tool-vision', { log: (m) => logs.push(m) });
    assert.equal(r.ok, true);
    assert.equal(r.changed, true);
    assert.deepEqual(r.removedDep, ['dsh-tool-vision']);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    assert.ok(!('dsh-tool-vision' in pkg.dependencies), '市场版依赖应被移除');
    assert.ok('my-fork' in pkg.dependencies, '本地链接必须保留');
    assert.ok(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8').trim() === '', 'patch 行应被清空');
  } finally {
    rmRf(dir);
  }
});

test('removeMarketDuplicate：无 profile 文件时静默成功', () => {
  const dir = makeTmpProfile();
  try {
    const r = removeMarketDuplicate(dir, 'no-such');
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
  } finally {
    rmRf(dir);
  }
});

// ---------------------------------------------------------------------------
// profile-module-heal.healProfileModuleShadowing
// ---------------------------------------------------------------------------

function junction(target: string, link: string): void {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  execSync(`cmd /c mklink /J "${link}" "${target}"`, { stdio: 'ignore' });
}

function rmRf(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
}

test('heal：遮蔽拷贝被移除、fallback 不健康时保留、外部 store 链接保留', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vt-heal-'));
  try {
    // fallback：一个健康 junction 包 + 一个不健康的空目录包
    const realPkg = path.join(home, 'real-pkg', 'pkg-a');
    fs.mkdirSync(realPkg, { recursive: true });
    fs.writeFileSync(path.join(realPkg, 'package.json'), '{"name":"pkg-a"}');
    junction(realPkg, path.join(home, 'profiles', 'node_modules', 'pkg-a'));
    fs.mkdirSync(path.join(home, 'profiles', 'node_modules', 'pkg-bad'), { recursive: true });

    // profile 内：pkg-a 真实拷贝（应删）、pkg-bad 遮蔽拷贝（fallback 不健康 → 留）
    const pmDir = path.join(home, 'profiles', 'web', 'node_modules');
    fs.mkdirSync(path.join(pmDir, 'pkg-a'), { recursive: true });
    fs.writeFileSync(path.join(pmDir, 'pkg-a', 'index.js'), 'shadow');
    fs.mkdirSync(path.join(pmDir, 'pkg-bad'), { recursive: true });
    fs.writeFileSync(path.join(pmDir, 'pkg-bad', 'index.js'), 'last-healthy');

    const removed = healProfileModuleShadowing(home, 'web', () => {});
    assert.deepEqual(removed, ['pkg-a'], `removed=${JSON.stringify(removed)}`);
    assert.ok(!fs.existsSync(path.join(pmDir, 'pkg-a')), '遮蔽拷贝应被删除');
    assert.ok(fs.existsSync(path.join(pmDir, 'pkg-bad', 'index.js')), 'fallback 不健康时 shadow 必须保留');
  } finally {
    rmRf(home);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scripts/patch-deps.js 需导出可注入 root 的 patchDshPluginPnpmHide(root)：
// rc.2 起内核 lib/plugin-<hash>.js 的哈希必然变化，补丁必须按内容扫描而非
// 认死文件名（rc.7 时代硬编码 plugin-9h8shc4d.js 会静默失效 → pnpm 黑窗回归）。
import { patchDshPluginPnpmHide } from '../scripts/patch-deps.js';

// 夹具必须逐字复刻上游 spawnSync 目标代码（两 Tab 缩进），否则 PNPM_SHELL_OLD 不命中
const OLD_SRC = [
  'const r = spawnSync("pnpm", args, {',
  '\tstdio: "inherit",',
  '\t\tshell: process.platform === "win32"',
  '\t});',
].join('\n');

function makeRoot(hashName) {
  const root = mkdtempSync(join(tmpdir(), 'patchdeps-'));
  const lib = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, hashName), OLD_SRC, 'utf8');
  return { root, lib };
}

test('按内容扫描任意 plugin-*.js chunk 并打 windowsHide 补丁', () => {
  const { root, lib } = makeRoot('plugin-DIFFERENTHASH.js');
  const r = patchDshPluginPnpmHide(root);
  assert.equal(r.patched, true);
  const out = readFileSync(join(lib, 'plugin-DIFFERENTHASH.js'), 'utf8');
  assert.ok(out.includes('windowsHide: true'));
});

test('幂等：已打补丁的树二次运行不再改写', () => {
  const { root, lib } = makeRoot('plugin-X.js');
  patchDshPluginPnpmHide(root);
  const before = readFileSync(join(lib, 'plugin-X.js'), 'utf8');
  const r = patchDshPluginPnpmHide(root);
  assert.equal(r.patched, false);
  assert.equal(readFileSync(join(lib, 'plugin-X.js'), 'utf8'), before);
});

test('无 dsh 包 / 无目标代码时优雅跳过不抛错', () => {
  const empty = mkdtempSync(join(tmpdir(), 'patchdeps-empty-'));
  assert.equal(patchDshPluginPnpmHide(empty).patched, false);
});

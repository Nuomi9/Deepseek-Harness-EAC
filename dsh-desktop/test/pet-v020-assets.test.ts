// dsh-pet 0.2.0-hevc 升级接线测试：mov 素材集、客户端 .mov 分支、z-index 补丁、同步表条目。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'assets', 'plugins', 'dsh-pet');
const clientJs = readFileSync(join(pkg, 'lib', 'client.js'), 'utf8');
const syncSrc = readFileSync(join(root, 'lib', 'desktop', 'companion-sync.ts'), 'utf8');

test('hevc 变体随包 97 个真 alpha mov 素材', () => {
  const movs = readdirSync(join(pkg, 'assets', 'mov')).filter((f) => f.endsWith('.mov'));
  assert.ok(movs.length >= 90, 'mov 素材数异常: ' + movs.length);
  assert.equal(readdirSync(join(pkg, 'assets')).includes('webm'), false, 'hevc 变体不应含 webm');
});

test('客户端 THUMB_EXT 固定 .mov（Safari 分支）', () => {
  assert.match(clientJs, /THUMB_EXT\s*=\s*"\.mov"/);
});

test('EAC z-index 补丁就位', () => {
  assert.match(clientJs, /\.dsh-pet-root\{position:fixed;z-index:2147483647/);
  assert.match(clientJs, /\[data-shell-overlay\]\{z-index:2147483647!important\}/);
});

test('同步表：pet 条目更新、dsh-pet-settings 退役', () => {
  assert.match(syncSrc, /id: 'pet', name: 'dsh-pet', dir: 'dsh-pet', disabled: true/);
  assert.doesNotMatch(syncSrc, /dsh-pet-settings/);
});

// dsh-pet（0.2.0-hevc）overlay 不变量：EAC z-index 补丁、四角锚点、命中区、
// .mov 播放分支。内部实现随上游版本变化，本测试只钉住 EAC 补丁与对外契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'assets', 'plugins', 'dsh-pet', 'lib', 'client.js'), 'utf8');

test('EAC z-index 补丁：root 提到 CSS 最大值且 shell.overlay 容器一并抬升', () => {
  assert.match(source, /\.dsh-pet-root\{position:fixed;z-index:2147483647/);
  assert.match(source, /\[data-shell-overlay\]\{z-index:2147483647!important\}/);
});

test('四角锚点定义完整（position 配置契约）', () => {
  assert.match(source, /data-corner=\\"bottom-right\\"/);
  assert.match(source, /data-corner=\\"bottom-left\\"/);
  assert.match(source, /data-corner=\\"top-right\\"/);
  assert.match(source, /data-corner=\\"top-left\\"/);
});

test('命中区有界且指针可交互（周边点击穿透）', () => {
  assert.match(source, /\.dsh-pet-hit\{[^}]*pointer-events:auto/);
});

test('Safari 分支：播放扩展名固定 .mov', () => {
  assert.match(source, /THUMB_EXT\s*=\s*"\.mov"/);
});

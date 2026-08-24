// 11be738 移植回归：托盘「完全重启」项存在于 lib/tray.ts，位于「重启 Web 服务」
// 下方，click 语义为 forceQuit + relaunch + quit；且与「退出」形成两档区分
// （退出不 relaunch）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Task 3.2：createTray 迁 lib/tray.ts；main.js 经 require 接线。
const traySrc = readFileSync(join(root, 'lib', 'tray.ts'), 'utf8');

function menuItemBody(label: string): string {
  const i = traySrc.indexOf(`label: '${label}'`);
  assert.ok(i > 0, `缺少托盘菜单项「${label}」`);
  const end = traySrc.indexOf('},', i);
  return traySrc.slice(i, end);
}

test('托盘含「完全重启」项：forceQuit + relaunch + quit 三步语义', () => {
  const body = menuItemBody('完全重启');
  assert.match(body, /state\.forceQuit = true/, '须置 forceQuit 跳过驻留确认');
  assert.match(body, /app\.relaunch\(\)/, '须安排 relaunch（退出后自动拉起新实例）');
  assert.match(body, /app\.quit\(\)/, '须触发退出流程');
});

test('位置对齐 11be738：「完全重启」紧随「重启 Web 服务」之后', () => {
  const iRestart = traySrc.indexOf("label: '重启 Web 服务'");
  const iFull = traySrc.indexOf("label: '完全重启'");
  assert.ok(iRestart > 0 && iFull > iRestart,
    '「完全重启」应位于「重启 Web 服务」下方（11be738 原始位置）');
  // 两者之间不应再隔其他业务菜单项（仅允许注释/分隔符）。
  const iRestartEnd = traySrc.indexOf('},', iRestart);
  const between = traySrc.slice(iRestartEnd, iFull);
  assert.doesNotMatch(between, /label:/, '两项之间不应插入其他菜单项');
});

test('「退出」与「完全重启」两档区分：退出不 relaunch', () => {
  const quitBody = menuItemBody('退出');
  assert.match(quitBody, /state\.forceQuit = true/, '退出同样跳过驻留确认');
  assert.doesNotMatch(quitBody, /relaunch/, '普通退出不得 relaunch（否则变成重启）');
});

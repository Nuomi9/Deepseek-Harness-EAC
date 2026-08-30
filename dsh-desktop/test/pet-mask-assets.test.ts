// 桌宠黑底遮罩接线测试：素材-遮罩一一对应 + client.js 补丁钩子存在。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const thumb = join(root, 'assets', 'plugins', 'dsh-pet', 'assets', 'thumb');
const clientJs = readFileSync(join(root, 'assets', 'plugins', 'dsh-pet', 'lib', 'client.js'), 'utf8');

test('每个宠物动画 webm 都有同名 .mask.png 遮罩', () => {
  const webms = readdirSync(thumb).filter((f) => f.endsWith('.webm'));
  assert.ok(webms.length >= 20, 'webm 素材数异常: ' + webms.length);
  for (const f of webms) {
    assert.equal(existsSync(join(thumb, f.replace(/\.webm$/, '.mask.png'))), true, '缺少遮罩: ' + f);
  }
});

test('client.js 含遮罩钩子（探活后挂 mask-image）与 mask-repeat 规则', () => {
  assert.match(clientJs, /maskProbe/);
  assert.match(clientJs, /webkitMaskImage/);
  assert.match(clientJs, /-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat/);
});

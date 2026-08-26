import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const jobFence = require('../lib/extension-host/job-fence.js');

test('Task 9.1 围栏模式按平台选择原生策略与对应降级', () => {
  assert.equal(jobFence.fenceModeForPlatform('win32', true), 'win32-job');
  assert.equal(jobFence.fenceModeForPlatform('win32', false), 'taskkill-fallback');
  assert.equal(jobFence.fenceModeForPlatform('linux', true), 'unix-process-group');
  assert.equal(jobFence.fenceModeForPlatform('linux', false), 'process-group-fallback');
});

test('Task 9.1 Linux 原生围栏同时建立父死信号与独立进程组', () => {
  const source = readFileSync(join(root, 'native', 'supervisor', 'src', 'job.rs'), 'utf8');
  assert.match(source, /cfg\(target_os = "linux"\)/);
  assert.match(source, /PR_SET_PDEATHSIG/);
  assert.match(source, /setpgid/);
  assert.match(source, /killpg/);
});

test('Task 9.1 dsh web 的 Unix 启动参数真实建立独立进程组', { skip: process.platform === 'win32' }, async () => {
  const serverSource = readFileSync(join(root, 'lib', 'server.ts'), 'utf8');
  assert.match(serverSource, /detached:\s*!IS_WIN/);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  assert.ok(child.pid);
  try {
    const exited = once(child, 'exit');
    process.kill(-child.pid!, 'SIGTERM');
    await exited;
    assert.equal(child.signalCode, 'SIGTERM');
  } finally {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
  }
});

test('Task 9.1 Unix 降级围栏真实回收主进程与孙进程', { skip: process.platform === 'win32' }, async () => {
  jobFence._forceNativeUnavailableForTest(true);
  const fence = jobFence.createFence();
  const handle = fence.launch(process.execPath, [
    '-e',
    "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(String(child.pid)); setInterval(() => {}, 1000);",
  ]);
  let output = '';
  handle.stdout.setEncoding('utf8');
  handle.stdout.on('data', (chunk: string) => { output += chunk; });
  try {
    while (!/^\d+$/.test(output)) await once(handle.stdout, 'data');
    const grandchildPid = Number(output);
    assert.ok(process.kill(handle.pid, 0) === true);
    assert.ok(process.kill(grandchildPid, 0) === true);
    const exited = once(handle.stdout, 'close');
    await handle.kill();
    await exited;
    assert.throws(() => process.kill(handle.pid, 0));
    assert.throws(() => process.kill(grandchildPid, 0));
  } finally {
    await handle.kill();
    fence.dispose();
    jobFence._forceNativeUnavailableForTest(false);
  }
});

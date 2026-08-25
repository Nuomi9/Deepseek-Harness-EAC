// test/process.test.ts — dsh web 子进程封装纯函数测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startDsh, waitForReadyLine, readyLinePattern, stopChildTree, bundledNodeExe, bundledDshBin } from '../src/service/process';
import type { ChildProcessLike } from '../src/service/process';

function fakeChild(): ChildProcessLike & { exitCode: number | null; emitted: string[]; emit: (ev: string, ...args: unknown[]) => void } {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const child = {
    pid: 1234,
    exitCode: null as number | null,
    emitted: [] as string[],
    stdout: {
      on: (ev: 'data', cb: (c: Buffer) => void) => {
        (handlers[ev] ??= []).push(cb as (...a: unknown[]) => void);
      },
    },
    stderr: {
      on: () => {},
    },
    on: (ev: 'exit' | 'error', cb: (...a: unknown[]) => void) => {
      (handlers[ev] ??= []).push(cb);
    },
    kill: () => true,
    emit(ev: string, ...args: unknown[]) {
      child.emitted.push(ev);
      for (const h of handlers[ev] ?? []) h(...args);
    },
  };
  return child as unknown as ChildProcessLike & { exitCode: number | null; emitted: string[]; emit: (ev: string, ...args: unknown[]) => void };
}

test('bundledNodeExe/bundledDshBin 解析到仓库约定路径', () => {
  const root = 'C:\\repo';
  assert.equal(bundledNodeExe(root), join(root, 'vendor', 'node', process.platform === 'win32' ? 'node.exe' : 'node'));
  assert.equal(bundledDshBin(root), join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
});

test('startDsh 构造正确的启动参数（含 --no-open / --patch / profile / DSH_HOME）', () => {
  const spawned: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
  const spawnImpl = (command: string, args: string[], options: Record<string, unknown>) => {
    spawned.push({ command, args, options });
    return fakeChild();
  };
  // 真实存在的 overlay 文件才会被透传（--patch）
  const overlay = join(require('node:os').tmpdir(), `dsh-eac-test-patch-${Math.random().toString(36).slice(2)}.yml`);
  require('node:fs').writeFileSync(overlay, '[]\n');
  startDsh(
    {
      host: '127.0.0.1',
      port: 3080,
      profile: 'web-desktop',
      dshHome: 'C:\\dsh-home',
      nodeExe: 'C:\\vendor\\node.exe',
      bin: 'C:\\bin.js',
      extraArgs: ['--foo'],
      patchOverlays: [overlay],
      openInBrowser: false,
    },
    spawnImpl as never,
  );
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, 'C:\\vendor\\node.exe');
  assert.deepEqual(spawned[0].args, [
    '--use-system-ca',
    'C:\\bin.js',
    '--profile',
    'web-desktop',
    '--host',
    '127.0.0.1',
    '--port',
    '3080',
    '--no-open',
    '--patch',
    overlay,
    '--foo',
  ]);
  const env = spawned[0].options.env as Record<string, string>;
  assert.equal(env.DSH_HOME, 'C:\\dsh-home');
  assert.equal(env.DSH_DESKTOP_PROFILE, 'web-desktop');
  require('node:fs').rmSync(overlay, { force: true });
});

test('startDsh: openInBrowser=true 时不追加 --no-open', () => {
  const spawned: { args: string[] }[] = [];
  const spawnImpl = (_c: string, args: string[]) => {
    spawned.push({ args });
    return fakeChild();
  };
  startDsh(
    {
      host: '127.0.0.1',
      port: 3080,
      profile: 'web-desktop',
      dshHome: 'C:\\h',
      nodeExe: 'C:\\node.exe',
      bin: 'C:\\bin.js',
      extraArgs: [],
      patchOverlays: [],
      openInBrowser: true,
    },
    spawnImpl as never,
  );
  assert.ok(!spawned[0].args.includes('--no-open'));
});

test('readyLinePattern 匹配桌面版就绪行格式', () => {
  const m = 'dsh web: http://127.0.0.1:3080/'.match(readyLinePattern());
  assert.ok(m);
  assert.equal(m![1], 'http://127.0.0.1:3080/');
});

test('waitForReadyLine: 就绪行出现即返回 URL', async () => {
  const child = fakeChild();
  const p = waitForReadyLine(child, 5000);
  child.emit('data', Buffer.from('dsh web: http://127.0.0.1:3080/\n'));
  const url = await p;
  assert.equal(url, 'http://127.0.0.1:3080/');
});

test('waitForReadyLine: 进程退出返回 null', async () => {
  const child = fakeChild();
  const p = waitForReadyLine(child, 5000);
  child.emit('exit', 1, null);
  assert.equal(await p, null);
});

test('waitForReadyLine: 超时返回 null', async () => {
  const child = fakeChild();
  const p = waitForReadyLine(child, 50);
  assert.equal(await p, null);
});

test('stopChildTree: Windows 用 taskkill /T', async () => {
  const calls: string[][] = [];
  const spawnImpl = (_c: string, args: string[]) => {
    calls.push(args);
    return fakeChild();
  };
  const child = fakeChild();
  child.pid = 999;
  await stopChildTree(child, spawnImpl as never, 'win32', 20);
  assert.ok(calls.length >= 1);
  assert.deepEqual(calls[0].slice(0, 3), ['/pid', '999', '/T']);
});

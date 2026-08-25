// test/manager.test.ts — ServiceManager 状态机测试（依赖注入假实现）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { ServiceManager, resolvePort, defaultDshHome, type ManagerOptions, type DesktopCoreApi } from '../src/service/manager';
import type { ChildProcessLike } from '../src/service/process';

function fakeChild(onExit?: () => void): ChildProcessLike & { exitCode: number | null; emit: (ev: string, ...a: unknown[]) => void; stdoutBuf: (s: string) => void } {
  const dataHandlers: ((c: Buffer) => void)[] = [];
  const exitHandlers: (() => void)[] = [];
  const obj = {
    pid: 4321,
    exitCode: null as number | null,
    stdout: { on: (_e: 'data', cb: (c: Buffer) => void) => dataHandlers.push(cb) },
    stderr: { on: () => {} },
    on: (ev: 'exit' | 'error', cb: (...a: unknown[]) => void) => {
      if (ev === 'exit') exitHandlers.push(() => cb());
    },
    kill: () => true,
    emit(ev: string, ...a: unknown[]) {
      if (ev === 'data') for (const h of dataHandlers) h(a[0] as Buffer);
      if (ev === 'exit') {
        obj.exitCode = a[0] as number;
        for (const h of exitHandlers) h();
        onExit?.();
      }
    },
    stdoutBuf(s: string) {
      obj.emit('data', Buffer.from(s));
    },
  };
  return obj as unknown as ChildProcessLike & { exitCode: number | null; emit: (ev: string, ...a: unknown[]) => void; stdoutBuf: (s: string) => void };
}

function makeOpts(overrides: Partial<ManagerOptions> = {}): ManagerOptions {
  return {
    host: '127.0.0.1',
    port: 0,
    autoStart: true,
    stopOnExit: true,
    profile: 'web-desktop',
    dshHome: join(tmpdir(), 'dsh-eac-test-' + Math.random().toString(36).slice(2)),
    extraArgs: [],
    patchOverlays: [],
    openInBrowser: false,
    repoRoot: join(process.cwd(), '..'), // 仓库根（vendor/node、node_modules 所在）
    userDataDir: tmpdir(),
    logsDir: tmpdir(),
    syncBuiltinPlugins: false,
    startTimeoutMs: 2000,
    firstBootTimeoutMs: 5000,
    healthIntervalMs: 0,
    ...overrides,
  };
}

function makeCore(overrides: Partial<DesktopCoreApi> = {}): DesktopCoreApi {
  return {
    syncAll: () => ({ ok: true }),
    loadSettings: () => ({}),
    saveSettings: () => {},
    desktopProfile: () => 'web-desktop',
    desktopProfileDir: () => join(tmpdir(), 'profile'),
    ensureDesktopProfileInit: () => {},
    companionPluginsCount: 0,
    ...overrides,
  };
}

test('内置 Node 缺失 → failed err.runtimeNotFound', async () => {
  const opts = makeOpts({ repoRoot: 'C:\\nonexistent-repo' });
  const m = new ServiceManager(opts, {
    probeService: async () => 'down',
    spawnImpl: (() => fakeChild()) as never,
    log: () => {},
    core: null,
  });
  const s = await m.ensureRunning();
  assert.equal(s.state, 'failed');
  assert.equal(s.error, 'err.runtimeNotFound');
});

test('探测到已有 DSH 服务 → 直接复用（owned=false）', async () => {
  const m = new ServiceManager(makeOpts({ port: 3080 }), {
    probeService: async () => 'dsh',
    spawnImpl: (() => fakeChild()) as never,
    log: () => {},
    core: null,
  });
  const s = await m.ensureRunning();
  assert.equal(s.state, 'ready');
  assert.equal(s.owned, false);
  assert.equal(s.url, 'http://127.0.0.1:3080/');
});

test('端口被其他程序占用 → 自动替换为空闲端口并启动', async () => {
  const opts = makeOpts({ port: 3080 });
  const m = new ServiceManager(opts, {
    probeService: async (_h: string, port: number) => (port === 3080 ? 'foreign' : 'down'),
    spawnImpl: (() => fakeChild()) as never,
    log: () => {},
    core: null,
  });
  const p = m.ensureRunning();
  // 不等启动流程完成（fake child 不发就绪行），先验证端口已切换
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(m.getTarget().port, 3081);
  await m.stop();
  await p.catch(() => {});
});

test('autoStart=false 且无服务 → failed err.notRunning', async () => {
  const m = new ServiceManager(makeOpts({ autoStart: false }), {
    probeService: async () => 'down',
    spawnImpl: (() => fakeChild()) as never,
    log: () => {},
    core: null,
  });
  const s = await m.ensureRunning();
  assert.equal(s.state, 'failed');
  assert.equal(s.error, 'err.notRunning');
});

test('启动成功：就绪行出现 → ready（owned=true）', async () => {
  const child = fakeChild();
  const m = new ServiceManager(makeOpts({ port: 3080 }), {
    probeService: async () => 'down',
    spawnImpl: (() => child) as never,
    log: () => {},
    core: null,
  });
  const p = m.ensureRunning();
  // 等启动流程推进到 spawn 后注入就绪行
  setTimeout(() => child.stdoutBuf('dsh web: http://127.0.0.1:3080/\n'), 50);
  const s = await p;
  assert.equal(s.state, 'ready');
  assert.equal(s.owned, true);
  assert.equal(s.url, 'http://127.0.0.1:3080/');
});

test('进程启动后崩溃 → failed err.startCrashed', async () => {
  const child = fakeChild();
  const m = new ServiceManager(makeOpts({ port: 3080, startTimeoutMs: 5000 }), {
    probeService: async () => 'down',
    spawnImpl: (() => child) as never,
    log: () => {},
    core: null,
  });
  const p = m.ensureRunning();
  setTimeout(() => child.emit('exit', 1), 50);
  const s = await p;
  assert.equal(s.state, 'failed');
  assert.equal(s.error, 'err.startCrashed');
});

test('启动超时 → failed err.startTimeout', async () => {
  const m = new ServiceManager(makeOpts({ port: 3080, startTimeoutMs: 300 }), {
    probeService: async () => 'down',
    spawnImpl: (() => fakeChild()) as never,
    log: () => {},
    core: null,
  });
  const s = await m.ensureRunning();
  assert.equal(s.state, 'failed');
  assert.equal(s.error, 'err.startTimeout');
});

test('stop: 停掉自启子进程回到 idle', async () => {
  const child = fakeChild();
  const m = new ServiceManager(makeOpts({ port: 3080 }), {
    probeService: async () => 'down',
    spawnImpl: (() => child) as never,
    log: () => {},
    core: null,
  });
  await m.ensureRunning().catch(() => {});
  await m.stop();
  assert.equal(m.getSnapshot().state, 'idle');
});

test('插件同步在启动前执行（onSyncDone 被调用）', async () => {
  const child = fakeChild();
  let synced = 0;
  const m = new ServiceManager(makeOpts({ port: 3080, syncBuiltinPlugins: true }), {
    probeService: async () => 'down',
    spawnImpl: (() => child) as never,
    log: () => {},
    core: makeCore({ companionPluginsCount: 11 }),
    onSyncDone: (n) => {
      synced = n;
    },
  });
  const p = m.ensureRunning();
  setTimeout(() => child.stdoutBuf('dsh web: http://127.0.0.1:3080/\n'), 50);
  await p;
  assert.equal(synced, 11);
});

test('resolvePort: 配置 0 且 settings.webPort 已有 DSH → 复用该端口', async () => {
  const core = makeCore({ loadSettings: () => ({ webPort: 3456 }) });
  const r = await resolvePort(makeOpts(), {
    probeService: async () => 'dsh',
    spawnImpl: (() => fakeChild()) as never,
    log: () => {},
    core,
  }, 'http://127.0.0.1:3456/');
  assert.equal(r.port, 3456);
  assert.equal(r.reuse, true);
});

test('defaultDshHome 与桌面版一致（~/.dsh-v4lite）', () => {
  assert.ok(defaultDshHome().endsWith('.dsh-v4lite'));
});

test('restart 幂等：并发调用共享同一次流程', async () => {
  const child = fakeChild();
  const m = new ServiceManager(makeOpts({ port: 3080 }), {
    probeService: async () => 'down',
    spawnImpl: (() => child) as never,
    log: () => {},
    core: null,
  });
  const p1 = m.restart();
  const p2 = m.restart();
  assert.equal(p1, p2);
  setTimeout(() => child.stdoutBuf('dsh web: http://127.0.0.1:3080/\n'), 50);
  const s = await p1;
  assert.equal(s.state, 'ready');
});

// 确保临时目录辅助函数可用（避免未使用告警）
void mkdtempSync;
void mkdirSync;

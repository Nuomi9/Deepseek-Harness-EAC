// test/detect.test.ts — 端口探测纯函数测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeService, findFreePort, PORT_FALLBACK_ATTEMPTS } from '../src/service/detect';

test('probeService: 200 且含 DSH 标记 → dsh', async () => {
  const fetchImpl = async () =>
    ({ ok: true, text: async () => '<html>window.__DSH_BOOT__ = {...}</html>' }) as Response;
  assert.equal(await probeService('127.0.0.1', 3080, 1000, fetchImpl), 'dsh');
});

test('probeService: 200 但无标记 → foreign', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => '<html>nginx</html>' }) as Response;
  assert.equal(await probeService('127.0.0.1', 3080, 1000, fetchImpl), 'foreign');
});

test('probeService: 非 200 → foreign', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '' }) as Response;
  assert.equal(await probeService('127.0.0.1', 3080, 1000, fetchImpl), 'foreign');
});

test('probeService: 连接失败 → down', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  assert.equal(await probeService('127.0.0.1', 3080, 1000, fetchImpl), 'down');
});

test('probeService: 超时中断 → down', async () => {
  const fetchImpl = async () => {
    // 模拟 AbortError（fetch 超时）
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  assert.equal(await probeService('127.0.0.1', 3080, 1000, fetchImpl), 'down');
});

test('findFreePort: 返回第一个空闲端口', async () => {
  const probe = async (_h: string, port: number) => (port === 3081 ? 'down' : 'foreign');
  assert.equal(await findFreePort('127.0.0.1', 3080, PORT_FALLBACK_ATTEMPTS, probe), 3081);
});

test('findFreePort: 全部占用 → null', async () => {
  const probe = async () => 'foreign' as const;
  assert.equal(await findFreePort('127.0.0.1', 3080, 5, probe), null);
});

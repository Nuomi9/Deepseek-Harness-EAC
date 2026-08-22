'use strict';

// shell-host.js — Tauri 壳的 Node sidecar 入口（stdio 行式 JSON-RPC 服务）。
//
// 协议：
//   请求  {"id":N,"method":"ns.fn","params":{...}}
//   响应  {"id":N,"ok":true,"result":...} | {"id":N,"ok":false,"error":"..."}
//   事件  {"event":"log","tag":..,"msg":..} | {"event":"notify",..}
//         | {"event":"balance","data":..}   （无 id，壳层单向消费）
//
// 职责只有三件事：解析 argv、装配 desktop-core、按方法表分发 RPC。
// 全部业务在 desktop-core.js（可单测）；本文件不写业务逻辑。

const { createDesktopCore } = require('./desktop-core');

function argOf(name, fallback) {
  const eq = '--' + name + '=';
  const hit = process.argv.find((a) => a.startsWith(eq));
  if (hit) return hit.slice(eq.length);
  // 兼容空格分隔形式（Rust 侧 Command::arg 的传法）：--name value
  const idx = process.argv.indexOf('--' + name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const appRoot = argOf('app-root', __dirname);
const userDataDir = argOf('user-data', '');
const logsDir = argOf('logs-dir', '');
const dshHome = argOf('dsh-home', '');

if (!userDataDir || !logsDir || !dshHome) {
  process.stderr.write('[shell-host] missing required args: user-data/logs-dir/dsh-home\n');
  process.exit(1);
}

// RPC 写出：单行 JSON + \n。stdout 只承载协议流量。
function send(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {
    // 管道断了（壳已退出）：静默退出。
    process.exit(0);
  }
}

// 内置运行时定位：打包布局 <resource>/app 与 <resource>/node|npm 平级；
// dev 布局：仓库根下 vendor/。两种位置统一探测。
const NODE_EXE = [
  require('node:path').join(appRoot, '..', 'node', 'node.exe'),
  require('node:path').join(appRoot, 'vendor', 'node', 'node.exe'),
].find((p) => require('node:fs').existsSync(p)) || require('node:path').join(appRoot, 'vendor', 'node', 'node.exe');
const NPM_CLI = [
  require('node:path').join(appRoot, '..', 'npm', 'bin', 'npm-cli.js'),
  require('node:path').join(appRoot, 'vendor', 'npm', 'bin', 'npm-cli.js'),
].find((p) => require('node:fs').existsSync(p)) || require('node:path').join(appRoot, 'vendor', 'npm', 'bin', 'npm-cli.js');

const rpcLog = (tag, msg) => send({ event: 'log', tag, msg });
const settingsCtx = {
  userDataDir,
  nodeExe: () => NODE_EXE,
  npmCli: () => NPM_CLI,
  log: (m) => rpcLog('update', m),
};

const core = createDesktopCore({
  appRoot,
  userDataDir,
  logsDir,
  dshHome,
  nodeExe: () => NODE_EXE,
  npmCli: () => NPM_CLI,
  log: rpcLog,
  notify: (title, body) => send({ event: 'notify', title, body }),
});

async function refreshBalanceAndEmit() {
  const result = await core.refreshBalance();
  send({ event: 'balance', data: result });
  return result;
}

// 方法表：ns.fn → handler(params)。全部 async 化以便统一错误处理。
const METHODS = {
  // ---- profile 编排 ----
  'profile.migrateAndSync': (p) => core.migrateAndSync(),
  'profile.syncAll': (p) => core.syncAll(),

  // ---- koffi 预检 ----
  'koffi.preflight': (p) => core.koffiPreflight(),

  // ---- 保护中心 ----
  'guard.action': (p) => core.guardAction(p),
  'guard.snapshot': ({ reason } = {}) => core.ensureGuard().snapshot(String(reason || 'manual')),
  'guard.markGood': ({ id } = {}) => { core.ensureGuard().markGood(id); return { ok: true }; },
  'guard.healthCheck': () => core.ensureGuard().healthCheck(),
  'guard.repair': ({ findings } = {}) => core.ensureGuard().repair(findings),
  'guard.lastGood': () => core.ensureGuard().lastGoodSnapshot(),
  'guard.restore': ({ id } = {}) => core.ensureGuard().restore(id),
  'guard.listSnapshots': () => core.ensureGuard().listSnapshots(),
  'guard.reportIncident': ({ title, detail } = {}) => core.ensureGuard().reportIncident(title, detail),
  'guard.junctionTick': () => core.junctionTick(),
  'guard.allowBuildsPreRetry': (p) => core.guardAllowBuildsPreRetry(p),

  // ---- 插件管理 / 更新 ----
  'plugin.list': () => core.pluginManagerCollect(),
  'plugin.setEnabled': ({ id, enabled } = {}) => core.pluginManagerSetEnabled(id, !!enabled),
  'plugin.setRemoved': ({ id, removed } = {}) => core.pluginManagerSetRemoved(String(id), !!removed),
  'updates.check': (p) => core.updatesCheck(p),
  'updates.list': (p) => core.updatesList(p),
  'updates.updateOne': (p) => core.updatesUpdateOne(p),
  'updates.setAutoUpdate': (p) => core.updatesSetAutoUpdate(p),

  // ---- 余额 ----
  'balance.refresh': () => refreshBalanceAndEmit(),
  'balance.pricesGet': ({ model } = {}) => core.balancePricesGet(model),
  'balance.pricesSet': ({ model, prices } = {}) => {
    const r = core.balancePricesSet(model, prices);
    if (r.ok) refreshBalanceAndEmit().catch(() => {}); // 保存后立即重推
    return r;
  },
  'balance.pricesReset': ({ model } = {}) => {
    const r = core.balancePricesReset(model);
    if (r.ok) refreshBalanceAndEmit().catch(() => {});
    return r;
  },

  // ---- updater（启动失败对话框链用）----
  'updater.previousAgentInfo': () => require('./updater').previousAgentInfo(settingsCtx),
  'updater.rollbackToPrevious': () => require('./updater').rollbackToPrevious(settingsCtx),
  'updater.rollback': () => require('./updater').rollback(settingsCtx),
  'updater.confirmHealthy': () => require('./updater').confirmPreviousAgentHealthy(settingsCtx),

  // ---- 插件市场排队任务 ----
  'market.processPending': () => core.processPendingMarketOps(),
};

// 心跳保活：stdin EOF 即退出（壳退出时关闭管道 → sidecar 自然收场）。
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
process.on('uncaughtException', (err) => {
  send({ event: 'log', tag: 'sidecar', msg: '未捕获异常: ' + String((err && err.stack) || err) });
});

let nextId = 0; // 请求 id 由壳分配，这里仅回显。

const pending = new Map(); // id -> {resolve}

async function dispatch(msg) {
  const id = Number.isFinite(msg.id) ? msg.id : ++nextId;
  const method = METHODS[msg.method];
  if (!method) {
    send({ id, ok: false, error: '未知方法: ' + String(msg.method) });
    return;
  }
  try {
    const result = await method(msg.params || {});
    send({ id, ok: true, result: result === undefined ? null : result });
  } catch (err) {
    send({ id, ok: false, error: String((err && err.message) || err) });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      send({ event: 'log', tag: 'sidecar', msg: '无法解析请求行: ' + err.message });
      continue;
    }
    dispatch(msg);
  }
});

send({ event: 'log', tag: 'sidecar', msg: `shell-host ready appRoot=${appRoot} profile=${core.desktopProfile()}` });

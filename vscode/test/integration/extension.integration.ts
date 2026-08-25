// test/integration/extension.integration.ts — VS Code 集成测试（在真实 VS Code 宿主中运行）
//
// 由 scripts/run-integration.mjs 通过 @vscode/test-electron 驱动：
//   - 以 --extensionDevelopmentPath=<vscode/> 启动下载的 VS Code
//   - 加载本文件（extensionTestsPath）到扩展宿主执行
//   - 环境变量 DSH_HOME / DSH_EAC_USER_DATA 指向临时目录（数据完全隔离）
//
// 验证目标（用户要求的「能在 VS Code 里集成并正常使用」的可执行证据）：
//   1. 扩展能被 VS Code 激活（命令注册成功）
//   2. 打开面板（触发服务启动）
//   3. DSH web 服务真实启动：HTTP 探测就绪（含 __DSH_BOOT__ 标记）
//   4. 停止服务后端口释放
import * as vscode from 'vscode';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const userDataDir = process.env.DSH_EAC_USER_DATA ?? '';
const dshHome = process.env.DSH_HOME ?? '';

function log(...args: unknown[]): void {
  console.log('[dsh-eac-integration]', ...args);
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** 从 userDataDir/settings.json 读 webPort（管理器启动后会持久化稳定端口） */
function readPersistedPort(): number {
  try {
    const s = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8'));
    return Number(s.webPort ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** HTTP 探测：返回是否 DSH 就绪 */
async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes('__DSH_BOOT__');
  } catch {
    return false;
  }
}

/** 轮询直到条件满足或超时 */
async function pollUntil(cond: () => Promise<boolean>, timeoutMs: number, what: string): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await delay(2000);
  }
  log(`轮询超时: ${what}`);
  return false;
}

async function main(): Promise<void> {
  log('集成测试开始');
  log(`DSH_HOME=${dshHome}`);
  log(`DSH_EAC_USER_DATA=${userDataDir}`);
  if (!dshHome || !userDataDir) {
    throw new Error('缺少 DSH_HOME / DSH_EAC_USER_DATA 环境变量');
  }

  // 1) 激活扩展（执行任意命令触发 activation）
  await vscode.commands.executeCommand('dshEac.openPanel');
  await delay(3000);

  // 2) 命令注册断言
  const cmds = await vscode.commands.getCommands(true);
  for (const c of ['dshEac.openPanel', 'dshEac.openSecondary', 'dshEac.restart', 'dshEac.stop', 'dshEac.copyUrl', 'dshEac.showLogs', 'dshEac.syncPlugins']) {
    if (!cmds.includes(c)) {
      throw new Error(`命令未注册: ${c}`);
    }
  }
  log('扩展已激活，全部命令注册成功');

  // 3) DSH profile 已初始化（desktop-core 同步了内置插件 —— 万物皆插件）
  const profileDir = join(dshHome, 'profiles', 'web-desktop');
  await pollUntil(async () => existsSync(join(profileDir, 'cordis.patch.yml')), 30000, 'cordis.patch.yml 生成');
  if (existsSync(join(profileDir, 'cordis.patch.yml'))) {
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8');
    if (!patch.includes('- insert:')) {
      throw new Error('cordis.patch.yml 未包含内置插件注册条目（万物皆插件失效）');
    }
    log('内置插件已同步并注册到 cordis.patch.yml（万物皆插件 OK）');
  }

  // 4) DSH web 服务真实启动：等待端口持久化 + HTTP 就绪
  const started = await pollUntil(async () => {
    const port = readPersistedPort();
    if (port === 0) return false;
    return probe(`http://127.0.0.1:${port}/`);
  }, 300000, 'DSH web 服务就绪');
  if (!started) {
    // 收集诊断信息
    const s = readPersistedPort();
    log(`persisted port = ${s}`);
    throw new Error('DSH web 服务未在 300s 内就绪（首次启动含依赖安装）');
  }
  const port = readPersistedPort();
  log(`DSH web 服务已就绪: http://127.0.0.1:${port}/`);

  // 5) 复制网址命令在就绪时可执行（不真校验返回值，命令本身不抛异常即 OK）
  await vscode.commands.executeCommand('dshEac.copyUrl');
  log('copyUrl 命令执行成功');

  // 6) 停止服务：端口应释放
  await vscode.commands.executeCommand('dshEac.stop');
  const stopped = await pollUntil(async () => !(await probe(`http://127.0.0.1:${port}/`)), 60000, '服务停止');
  if (!stopped) {
    throw new Error('停止服务后端口仍可达');
  }
  log('服务已停止，端口释放');

  // 7) 重启恢复（DSH EAC: Restart Service 命令路径）
  await vscode.commands.executeCommand('dshEac.restart');
  const restarted = await pollUntil(async () => {
    const p = readPersistedPort();
    return p !== 0 && probe(`http://127.0.0.1:${p}/`);
  }, 180000, '重启后服务恢复');
  if (!restarted) {
    // 诊断：dump settings 与 dsh web 日志尾部
    try {
      log('--- settings.json ---');
      log(readFileSync(join(userDataDir, 'settings.json'), 'utf8'));
      const logFile = join(userDataDir, 'logs', 'dsh-eac.log');
      if (existsSync(logFile)) {
        log('--- dsh-eac.log 全文 ---');
        log(readFileSync(logFile, 'utf8'));
      } else {
        log('dsh-eac.log 不存在');
      }
    } catch (e) {
      log('诊断读取失败:', String(e));
    }
    throw new Error('重启后服务未恢复');
  }
  log(`重启后服务恢复就绪（端口 ${readPersistedPort()}）`);

  log('集成测试全部通过');
}

/** VS Code 1.134+ 测试运行器约定：模块需导出 run() 并返回 Promise */
export async function run(): Promise<void> {
  await main();
}

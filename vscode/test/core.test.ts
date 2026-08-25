// test/core.test.ts — desktop-core 集成测试（万物皆插件的实证）
//
// 与插件运行时一致：从仓库根真实加载 desktop-core.js（不打包，__dirname 指向仓库根，
// assets/plugins、assets/skins、node_modules 相对路径才有效），用临时 DSH_HOME 验证：
//   1. profile 目录按官方模板初始化（package.json bundles + pnpm-workspace.yaml + cordis.patch.yml）
//   2. 内置插件/皮肤同步进 profile node_modules（copyPluginPackage）
//   3. cordis.patch.yml 幂等注册内置插件行（insert 条目）
//   4. syncAll 可重复执行（幂等：不重复注册、不残留空壳）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';

const repoRoot = join(process.cwd(), '..');

// 临时目录：优先 D 盘（空间充足；C 盘 100% 满时 syncAll 拷贝插件资产会 ENOSPC）
const D_TMP = 'D:\\vs code\\.test-tmp';
function testBase(): string {
  try {
    require('node:fs').accessSync(D_TMP);
    return D_TMP;
  } catch {
    return tmpdir();
  }
}
function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(testBase(), prefix));
}

// 与 src/core/desktopCore.ts 一致：eval('require') 从仓库根加载原始 CJS 模块
const nodeRequire = eval('require') as NodeRequire;
const coreFactory = nodeRequire(join(repoRoot, 'desktop-core.js')) as {
  createDesktopCore(ctx: Record<string, unknown>): {
    syncAll(): { ok: boolean; message?: string };
    ensureDesktopProfileInit(): void;
    desktopProfileDir(): string;
    loadSettings(): Record<string, unknown>;
    saveSettings(s: Record<string, unknown>): void;
    COMPANION_PLUGINS?: unknown[];
  };
};

function makeCore(dshHome: string) {
  return coreFactory.createDesktopCore({
    appRoot: repoRoot,
    userDataDir: dshHome,
    logsDir: join(dshHome, 'logs'),
    dshHome,
    nodeExe: () => join(repoRoot, 'vendor', 'node', 'node.exe'),
    npmCli: () => join(repoRoot, 'vendor', 'npm', 'bin', 'npm-cli.js'),
    log: () => {},
    notify: () => {},
  });
}

test('desktop-core 从仓库根加载并创建实例（不依赖 electron）', () => {
  const dshHome = makeTmpDir("dsh-eac-core-");
  const core = makeCore(dshHome);
  assert.ok(core.syncAll);
  assert.ok(core.ensureDesktopProfileInit);
  assert.ok((core.COMPANION_PLUGINS?.length ?? 0) > 0, '内置插件清单不应为空');
});

test('syncAll: 初始化 profile 并同步内置插件（万物皆插件）', { timeout: 120000 }, () => {
  const dshHome = makeTmpDir("dsh-eac-sync-");
  const core = makeCore(dshHome);

  core.ensureDesktopProfileInit();
  const profileDir = core.desktopProfileDir();
  assert.ok(existsSync(profileDir), 'profile 目录应已创建');

  // profile 官方模板文件
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
  assert.ok(existsSync(join(profileDir, 'pnpm-workspace.yaml')));
  assert.ok(existsSync(join(profileDir, 'cordis.patch.yml')));

  const r = core.syncAll();
  assert.ok(r.ok, `syncAll 应成功: ${r.message ?? ''}`);

  // cordis.patch.yml 应注册内置插件行（insert 条目）
  const patchFile = join(profileDir, 'cordis.patch.yml');
  const patch1 = readFileSync(patchFile, 'utf8');
  const insertCount = (patch1.match(/- insert:/g) ?? []).length;
  assert.ok(insertCount > 0, `cordis.patch.yml 应有 insert 条目，实际 ${insertCount}`);

  // 内置插件包应复制进 profile node_modules（抽查第一个插件）
  const companions = core.COMPANION_PLUGINS ?? [];
  assert.ok(companions.length > 0);
  const first = companions[0] as { name: string; dir?: string };
  const dirName = first.dir || (first.name.includes('/') ? first.name.split('/').pop()! : first.name);
  assert.equal(typeof dirName, 'string');
  const pkgPath = join(profileDir, 'node_modules', first.name, 'package.json');
  if (existsSync(join(repoRoot, 'assets', 'plugins', dirName))) {
    assert.ok(existsSync(pkgPath), `内置插件 ${first.name} 应已复制进 profile node_modules`);
  }

  // 内置插件清单标记（市场据此标「已内置」）
  const marker = JSON.parse(readFileSync(join(profileDir, '.dsh-builtin-plugins.json'), 'utf8'));
  assert.ok(Array.isArray(marker.names) && marker.names.length > 0);

  // 幂等：新实例二次 sync 后注册条目集合一致（removeMarketDuplicate 会删除内置行后
  // 重新追加，块顺序可能变化——对 cordis 解析无害；关键是不重复、不残留空壳、用户
  // 条目不丢失）
  const core2 = makeCore(dshHome);
  const r2 = core2.syncAll();
  assert.ok(r2.ok);
  const patch2 = readFileSync(patchFile, 'utf8');
  const ids = (s: string) => [...s.matchAll(/^\s+- id: (\S+)/gm)].map((m) => m[1]);
  const idSet1 = new Set(ids(patch1));
  const idSet2 = new Set(ids(patch2));
  assert.deepEqual([...idSet1].sort(), [...idSet2].sort(), '二次同步后注册条目集合应一致（幂等）');
  const idList = ids(patch2);
  assert.equal(idList.length, idSet2.size, '不应有重复 id 行');
  assert.equal((patch2.match(/- insert:/g) ?? []).length, idList.length, '不应有孤立空 insert 壳');
});

test('皮肤资产随包存在（assets/skins 非空）', () => {
  const skinsDir = join(repoRoot, 'assets', 'skins');
  if (!existsSync(skinsDir)) return; // 分支若裁剪皮肤则跳过
  const entries = readdirSync(skinsDir);
  assert.ok(entries.length > 0, 'assets/skins 应有皮肤包');
});

test('内置插件源资产存在（assets/plugins 非空）', () => {
  const pluginsDir = join(repoRoot, 'assets', 'plugins');
  assert.ok(existsSync(pluginsDir), 'assets/plugins 应存在');
  const entries = readdirSync(pluginsDir);
  assert.ok(entries.length > 0, 'assets/plugins 应有内置插件');
});

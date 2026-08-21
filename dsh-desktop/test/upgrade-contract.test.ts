// v5.0.0 升级契约：main 主线（origin/main ≤4.6.0，旧 JS 布局）升级到
// vnext 重构版（TS 隔离布局）的路径适配。锁死四条硬契约，防止后续改动
// 悄悄破坏老客户端的自更新链路：
//
//  1. 版本门槛：本分支版本必须 > main 最后版本 4.6.0 —— compareVersions
//     正是更新器判定「有新版本」的函数，门槛不过更新永远不会触发；
//  2. 资产命名：NSIS artifactName 必须是 Setup-v${version}-${arch}.${ext}
//     形态（origin/main 4.6.0 同款，v4.4.1 起启用）。老更新器（≥4.4.1）
//     的直连正则 /setup.*x64\.exe$/i 与 Gitee 分片候选（第 4 候选
//     Deepseek-Harness-EAC-Setup-v<version>-x64.exe）都必须能命中；
//  3. 残留清理：customInstall 幂等删除 main 旧布局独有、vnext 不再随包
//     的文件（rescue-agent.js / wsl-backend.js / extract-css.mjs），且
//     installer.nsh 的任何删除动作都不得触碰 .dsh（用户插件与配置所在）；
//  4. 发布上传：release.yml 通配上传 Setup-*.exe（带版本名），portable
//     保持固定名（%TEMP% 稳定解压缓存目录复用依赖它）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const builderYml = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
const nsh = readFileSync(join(root, 'build', 'installer.nsh'), 'utf8');
const releaseYml = readFileSync(join(root, '..', '.github', 'workflows', 'release.yml'), 'utf8');

/** main 最后一个发布版本（origin/main@dsh-desktop/package.json）。 */
const MAIN_LAST_VERSION = '4.6.0';

// --- 1. 版本门槛 -----------------------------------------------------------

test('版本门槛：当前版本 > main 主线最后版本 4.6.0，升级能被触发', async () => {
  const { compareVersions } = await import(new URL('../updater.js', import.meta.url));
  assert.ok(
    compareVersions(pkg.version, MAIN_LAST_VERSION) > 0,
    `${pkg.version} 必须 > ${MAIN_LAST_VERSION}，否则 main 老客户端永远检测不到新版本`,
  );
});

// --- 2. 资产命名 -----------------------------------------------------------

/** 提取 electron-builder.yml 顶层段（如 nsis: / portable:）的文本块。 */
function ymlSection(text: string, key: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `${key}:`);
  assert.ok(start >= 0, `electron-builder.yml 缺少 ${key}: 段`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

test('NSIS artifactName 为 Setup-v${version}-${arch}.${ext}（origin/main 4.6.0 同款形态）', () => {
  const m = /^\s{2}artifactName:\s*(\S+)$/m.exec(ymlSection(builderYml, 'nsis'));
  assert.ok(m, 'nsis 段缺少 artifactName');
  assert.equal(m[1], 'Deepseek-Harness-EAC-Setup-v${version}-${arch}.${ext}');
});

test('Portable artifactName 保持不带版本（%TEMP% 稳定解压缓存目录复用）', () => {
  const m = /^\s{2}artifactName:\s*(\S+)$/m.exec(ymlSection(builderYml, 'portable'));
  assert.ok(m, 'portable 段缺少 artifactName');
  assert.equal(m[1], 'Deepseek-Harness-EAC-Portable-${arch}.${ext}');
});

/** 按当前配置实际产出的安装包文件名（arch=x64 / ext=exe）。 */
const setupName = `Deepseek-Harness-EAC-Setup-v${pkg.version}-x64.exe`;

// origin/main@4.6.0 dsh-desktop/client-updater.js selectAsset 的匹配面：
//  - 直连（GitHub / Gitee 整文件）：/setup.*x64\.exe$/i
//  - Gitee 分片（>100MB 拆 .part1/.part2）：4 个 base 候选
//    （第 4 候选 v4.4.1 加入，commit 0178672）。更老（<4.4.1）的客户端
//    走不了新命名的分片路径，但直连路径始终可用。
const MAIN_DIRECT_RE = /setup.*x64\.exe$/i;
const mainSplitBases = (version: string, kind = 'Setup'): string[] => [
  `Deepseek-Harness-EAC-${kind}-x64.exe`,
  `Deepseek-Harness-EAC-v${version}-${kind}-x64.exe`,
  `Deepseek-Harness-EAC-${version}-${kind}-x64.exe`,
  `Deepseek-Harness-EAC-${kind}-v${version}-x64.exe`,
];

test('main 老更新器直连正则能命中新命名的安装包资产', () => {
  assert.match(setupName, MAIN_DIRECT_RE);
  // blockmap 等附属资产不会被误选（\.exe$ 锚定）。
  assert.doesNotMatch(`${setupName}.blockmap`, MAIN_DIRECT_RE);
});

test('main 老更新器（≥4.4.1）Gitee 分片候选能命中新命名', () => {
  assert.ok(
    mainSplitBases(pkg.version).includes(setupName),
    `${setupName} 必须在 main 更新器的分片候选列表内`,
  );
});

test('本分支 selectAsset：直连资产按新命名被选中（blockmap 不误选）', async () => {
  const { selectAsset } = await import(new URL('../client-updater.js', import.meta.url));
  const A = (name: string, size = 1000) => ({ name, size });
  const rel = {
    version: pkg.version,
    assets: [A(setupName), A(`${setupName}.blockmap`), A(`Deepseek-Harness-EAC-Portable-x64.exe`)],
  };
  const got = selectAsset(rel);
  assert.equal(got.name, setupName);
  assert.equal(got.parts.length, 1);
  assert.equal(got.totalSize, 1000);
});

test('本分支 selectAsset：Gitee 分片形态下新命名仍能按序收集（第 4 候选）', async () => {
  const { selectAsset } = await import(new URL('../client-updater.js', import.meta.url));
  const A = (name: string, size = 1000) => ({ name, size });
  const rel = {
    version: pkg.version,
    assets: [A(`${setupName}.part1`, 60), A(`${setupName}.part2`, 40)],
  };
  const got = selectAsset(rel);
  assert.equal(got.name, setupName);
  assert.deepEqual(got.parts.map((p) => p.name), [`${setupName}.part1`, `${setupName}.part2`]);
  assert.equal(got.totalSize, 100);
});

// --- 3. 残留清理与 .dsh 不可触碰 -------------------------------------------

/** 提取 installer.nsh 的 !macro <name> … !macroend 块。 */
function nshMacro(text: string, name: string): string {
  const m = new RegExp(`!macro\\s+${name}\\b([\\s\\S]*?)!macroend`).exec(text);
  assert.ok(m, `installer.nsh 缺少 !macro ${name}`);
  return m[1]!;
}

test('customInstall 幂等清理 main 旧布局残留文件（仅 resources\\app 内）', () => {
  const block = nshMacro(nsh, 'customInstall');
  for (const legacy of ['rescue-agent.js', 'wsl-backend.js', 'extract-css.mjs']) {
    assert.match(
      block,
      new RegExp(`Delete\\s+"\\$INSTDIR\\\\resources\\\\app\\\\${legacy}"`),
      `customInstall 必须删除 $INSTDIR\\resources\\app\\${legacy}`,
    );
  }
});

test('installer.nsh 的所有删除动作均不触碰 .dsh（插件与配置完整保留）', () => {
  const destructive = nsh
    .split(/\r?\n/)
    .filter((l) => /^\s*(Delete|RMDir)\b/i.test(l));
  assert.ok(destructive.length > 0, 'sanity：installer.nsh 应存在删除动作');
  for (const line of destructive) {
    assert.ok(!line.includes('.dsh'), `删除动作不得涉及 .dsh：${line.trim()}`);
  }
});

// --- 4. 发布上传 -----------------------------------------------------------

test('release.yml 通配上传 Setup-*.exe 且 portable 用固定名', () => {
  assert.match(releaseYml, /dsh-desktop\/dist\/Deepseek-Harness-EAC-Setup-\*\.exe/);
  assert.match(releaseYml, /dsh-desktop\/dist\/Deepseek-Harness-EAC-Portable-x64\.exe/);
});

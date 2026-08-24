'use strict';
// 依赖层小补丁（幂等）：目录选择器 worker 无消息退出时，把真实退出码/信号带进
// 错误文案。由 postinstall / pack / dist 在打包前应用；匹配失败只告警不中断。
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js');

const PATCH_MARKER = 'worker.on("exit", (code, signal) => {';
const OLD_RE = /worker\.on\("exit", \(\) => \{\s*settle\(\(\) => \{\s*reject\(\/\* @__PURE__ \*\/ new Error\("win32 folder dialog worker exited before reporting a result"\)\);\s*\}\);\s*\}\);/;
const NEW_BLOCK = [
  'worker.on("exit", (code, signal) => {',
  '\t\tsettle(() => {',
  '\t\t\tconst suffix = signal ? ` (signal ${signal})` : typeof code === "number" ? ` (exit code ${code})` : "";',
  '\t\t\treject(/* @__PURE__ */ new Error(`win32 folder dialog worker exited before reporting a result${suffix}`));',
  '\t\t});',
  '\t});',
].join('\n');

function patchPickerWorker() {
  if (!fs.existsSync(target)) {
    console.log('[patch-deps] dsh-host-directory-picker-native 不存在，跳过');
    return;
  }
  let src = fs.readFileSync(target, 'utf8');
  if (src.includes(PATCH_MARKER)) {
    console.log('[patch-deps] picker worker 退出码补丁已应用，跳过');
    return;
  }
  if (!OLD_RE.test(src)) {
    console.log('[patch-deps] picker-native 未匹配到目标代码（版本可能已更新），跳过');
    return;
  }
  src = src.replace(OLD_RE, NEW_BLOCK);
  fs.writeFileSync(target, src);
  console.log('[patch-deps] 已补丁 picker-native：worker 退出上报 exit code / signal');
}

// 设置弹窗左栏导航滚动补丁：上游 dsh-client-ui-settings-general 的 .nav/.navList
// 没有滚动约束，面板 overflow:hidden 会把排到底部的插件设置条目（如 ClawBot，
// order 50）直接裁掉且无法滚动到。给 navList 加 min-height:0 + overflow-y:auto，
// 并给 nav 补底部内边距，条目多时左栏变为可滚动列表。CSS 类名前缀是内容哈希，
// 用捕获组匹配以兼容上游小版本差异；幂等标记为 CSS 注释 dsh-desktop-nav-scroll。
const NAV_SCROLL_MARKER = 'dsh-desktop-nav-scroll';
const NAV_RE = /\.([A-Za-z0-9_-]+)_nav\{box-sizing:border-box;flex-direction:column;flex:none;gap:18px;width:188px;padding:22px 12px 0;display:flex\}/;
const NAVLIST_RE = /\.([A-Za-z0-9_-]+)_navList\{flex-direction:column;gap:4px;display:flex\}/;

function patchSettingsNavScroll() {
  const file = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js');
  if (!fs.existsSync(file)) {
    console.log('[patch-deps] dsh-client-ui-settings-general 不存在，跳过');
    return;
  }
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(NAV_SCROLL_MARKER)) {
    console.log('[patch-deps] 设置左栏滚动补丁已应用，跳过');
    return;
  }
  const navMatch = NAV_RE.exec(src);
  const navListMatch = NAVLIST_RE.exec(src);
  if (!navMatch || !navListMatch || navMatch[1] !== navListMatch[1]) {
    console.log('[patch-deps] 设置左栏未匹配到目标 CSS（上游版本可能已修复/更新），跳过');
    return;
  }
  const oldNav = navMatch[0];
  const oldNavList = navListMatch[0];
  const newNav = oldNav.replace('padding:22px 12px 0;', 'padding:22px 12px 12px;');
  const newNavList = oldNavList.replace(
    /\{flex-direction:column;gap:4px;display:flex\}$/,
    '{flex-direction:column;gap:4px;display:flex;min-height:0;overflow-y:auto;padding-bottom:10px;/*' + NAV_SCROLL_MARKER + '*/}'
  );
  src = src.replace(oldNav, newNav).replace(oldNavList, newNavList);
  fs.writeFileSync(file, src);
  console.log('[patch-deps] 已补丁 settings-general：设置弹窗左栏可滚动，底部条目不再被裁掉');
}

// dev 闭包注入：dsh-app-boot 从「内置 dsh 包」出发做 BFS 维护 profile 的
// fallback closure（profiles/node_modules junctions）。配套插件
// better-sidebar 的依赖 schemastery 只在 app 层 package.json 里（app 闭包），
// BFS 从 dsh 包出发不可达 → 全新 profile（独立 DSH_HOME）首次启动
// dsh web 因 ERR_MODULE_NOT_FOUND 崩溃（exit 1）。机制级修复：把 schemastery
// 声明进内置 dsh 包的 dependencies，BFS 就能经 app 闭包解析到它并维护
// junction；幂等（已有声明则跳过），npm ci 后由 postinstall 自动恢复。
function injectDshClosureExtras() {
  const dshPkgPath = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  if (!fs.existsSync(dshPkgPath)) return;
  let dshPkg;
  try {
    dshPkg = JSON.parse(fs.readFileSync(dshPkgPath, 'utf8'));
  } catch {
    console.log('[patch-deps] 内置 dsh 包不可解析，跳过闭包注入');
    return;
  }
  dshPkg.dependencies = dshPkg.dependencies || {};
  if (dshPkg.dependencies.schemastery) {
    console.log('[patch-deps] dsh 闭包已声明 schemastery，跳过');
    return;
  }
  let version = '';
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'schemastery', 'package.json'), 'utf8')).version || '';
  } catch {
    console.log('[patch-deps] app 闭包缺少 schemastery，跳过');
    return;
  }
  dshPkg.dependencies.schemastery = '^' + version;
  fs.writeFileSync(dshPkgPath, JSON.stringify(dshPkg, null, 2) + '\n');
  console.log('[patch-deps] 已注入 dsh 闭包：schemastery@^' + version);
}

// pnpm 黑窗补丁：内置 dsh CLI 的 plugin forwarder 用 spawnSync("pnpm", …, {shell: win32})
// 但没带 windowsHide —— Windows 上经 cmd.exe 中介执行 pnpm.cmd 时，无控制台的
// 桌面壳进程树（CREATE_NO_WINDOW 启动）每次调用都会新弹一个可见 cmd 黑窗；
// `dsh plugin add` 内部多次调用 pnpm → 同时弹两个，pnpm 网络慢时窗口久挂，
// 用户点 X 关窗即杀死 pnpm → "pnpm failed" 安装失败。加 windowsHide 即根除。
const PNPM_HIDE_MARKER = 'windowsHide: true';
const PNPM_SHELL_OLD = 'stdio: "inherit",\n\t\tshell: process.platform === "win32"\n\t});';
const PNPM_SHELL_NEW = 'stdio: "inherit",\n\t\tshell: process.platform === "win32",\n\t\twindowsHide: true\n\t});';

function patchDshPluginPnpmHide(root = path.resolve(__dirname, '..')) {
  // rc.7 时代 chunk 文件名是 plugin-9h8shc4d.js；上游每次发版哈希都会变，
  // 所以按「plugin-*.js 且内容命中 spawnSync 目标代码」扫描，认死文件名会
  // 在内核升级后静默失效（pnpm 黑窗回归）。任一候选已带幂等标记则跳过。
  const libDir = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  let names = [];
  try { names = fs.readdirSync(libDir); } catch { return { patched: false }; }
  const candidates = [];
  const legacy = path.join(libDir, 'plugin-9h8shc4d.js');
  if (fs.existsSync(legacy)) candidates.push(legacy);
  for (const name of names) {
    if (!/^plugin-[\w-]+\.js$/.test(name)) continue;
    const p = path.join(libDir, name);
    if (!candidates.includes(p)) candidates.push(p);
  }
  let target = null;
  for (const p of candidates) {
    let src = '';
    try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (src.includes(PNPM_HIDE_MARKER)) return { patched: false };
    if (src.includes(PNPM_SHELL_OLD)) { target = p; break; }
  }
  if (!target) return { patched: false };
  let src = fs.readFileSync(target, 'utf8');
  src = src.replace(PNPM_SHELL_OLD, PNPM_SHELL_NEW);
  fs.writeFileSync(target, src);
  console.log('[patch-deps] 已补丁 dsh CLI（' + path.basename(target) + '）：pnpm 调用 windowsHide，插件市场不再弹 cmd 黑窗');
  return { patched: true, file: target };
}

function main() {
  patchPickerWorker();
  patchSettingsNavScroll();
  injectDshClosureExtras();
  patchDshPluginPnpmHide();
}

if (require.main === module) main();

module.exports = { patchDshPluginPnpmHide };

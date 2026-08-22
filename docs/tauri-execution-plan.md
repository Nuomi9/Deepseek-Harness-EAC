# Tauri 迁移收尾 + TypeScript 化 实施计划

> **For agentic workers:** 按任务顺序执行，步骤用 `- [ ]` 勾选跟踪。红线与背景见
> `docs/tauri-migration-plan-v2.md`、`docs/tauri-migration-handoff.md`、`docs/tauri-typescript-refactor-design.md`。
>
> **计划体例说明**：V-B/V-A/V-D 脚手架等新代码给出完整代码；V-T 的模块移植任务以
> 「忠实移植规约 + 源文件即规范」方式表述（逐行翻译约 4000 行 JS 不可能在计划中内联，
> 规约本身是可执行的质量门）。

**Goal:** 完成 Tauri 迁移收尾（V-B/V-A/V-C/V-D/V-E），随后执行 V-T 把 sidecar 轨道全部 TS 化，功能与「万物皆插件」理念零变化。

**Architecture:** Rust 壳(tauri-app/) + Node sidecar(仓库根 JS → V-T 后 sidecar/dist) 经 stdio 行式 JSON-RPC 编排；TS 仅替换壳层胶水代码源码形态，编译为等价 CJS JS 运行。

**Tech Stack:** Tauri 2.11 / Rust 1.98-msvc / Node 24 / tsc 5.6 (多文件 emit, commonjs) / esbuild (仅 chrome 注入) / node:test

---

## Task 1（V-B）：修复 sidecar 契约测试偶发失败

**Files:**
- Modify: `test/sidecar-rpc.test.mjs`（接线 withLogs 到 113/141 两个测试）
- 可能 Modify: `desktop-core.js`（若根因在 copy 类操作，加有限重试——此文件是新轨代码，允许改）
- 禁止：根目录共享模块（plugin-guard.js 等 12 个，冻结双轨共享）

- [ ] **Step 1.1 接线 withLogs**：把两个偶发测试的断言体包进 `withLogs(s, ...)()`：

```js
// 'profile 初始化' 测试：s 创建后、try 内：
    try {
      await withLogs(s, async () => {
        const r = await s.rpc('profile.migrateAndSync', {}, 120000);
        assert.equal(r.ok, true);
        // …原断言原样搬入…
      })();
    } finally { s.kill(); }
```

对 `'保护中心快照/回滚/体检/事故闭环'` 同样处理。（withLogs 返回 async 函数，立即调用。）

- [ ] **Step 1.2 复现与取证**：跑全量并发直到复现或连续 3 次绿：
  `npm test` —— 若失败，断言错误消息尾部会带出 sidecar 日志（withLogs 效果），
  记录真实异常文本。
- [ ] **Step 1.3 按日志修根因**（决策树）：
  - 日志显示 `同步配套插件失败: EPERM/EBUSY/EACCES…`（copyPluginPackage 拷 assets 大目录撞锁）
    → 在 `desktop-core.js` 的 `copyPluginPackage` 对单文件复制加有限重试
    （如 3 次、50/200/800ms 退避，仅对 EPERM/EACCES/EBUSY/EMFILE）；
  - 日志显示其它异常 → 按实际栈精准修（仍在 desktop-core.js/shell-host.js 新轨范围内）；
  - 无法归因于产品代码 → 测试侧降并发：`package.json` test 脚本改
    `node --test --test-concurrency=4 \"test/*.test.mjs\"`（最后手段，需在提交说明里注明）。
- [ ] **Step 1.4 验收**：`npm test` 连续 3 次全绿（§5.2 两个预存失败除外）；隔离跑 7/7 绿。

## Task 2（V-A）：安全收紧〔采纳项 A/C〕

**Files:**
- Modify: `tauri-app/capabilities/main.json`
- Modify: `tauri-app/src/ipc.rs`
- 不动 frontend/chrome.ts（desktopShell 字段由 Rust 侧返回，无需重跑 build:inject）

- [ ] **Step 2.1 capabilities 收紧**：permissions 改为：

```json
"permissions": [
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  "core:window:allow-start-dragging",
  "core:webview:allow-internal-toggle-devtools"
]
```

（local 页 loading/recovery 只用到事件监听+拖拽+devtools；remote 页同 capability。
注意坑④：不能写裸 `allow-*`。）

- [ ] **Step 2.2 ipc.rs 加 origin 二重校验**：新增辅助并应用到敏感命令
  （guard_action / plugin_set_enabled / plugin_set_removed / plugin_update /
  plugin_auto_update / balance_prices_set / balance_prices_reset /
  chrome_menu 写操作分支：set-exit-action、restart-service、toggle-close-to-tray、quit）：

```rust
fn ensure_origin(st: &AppState, window: &WebviewWindow) -> Result<(), ()> {
    if ensure_main(window).is_err() { return Err(()); }
    let cur = window.url().map_err(|_| ())?;
    let cur_origin = cur.origin().to_string(); // url::Origin 序列化
    let local_ok = matches!(cur_origin.as_str(),
        \"http://tauri.localhost\" | \"https://tauri.localhost\" | \"tauri://localhost\");
    if local_ok { return Ok(()); }
    let web = st.web_url.lock().unwrap().clone();
    let web_origin = web.as_deref()
        .and_then(|u| url::Url::parse(u).ok())
        .map(|u| u.origin().to_string());
    if Some(cur_origin) == web_origin { Ok(()) } else { Err(()) }
}
```

敏感命令入口处 `if ensure_origin(&state, &window).is_err() { return json!({\"ok\":false,\"error\":\"unauthorized\"}); }`
（chrome_menu 只拦写操作分支，reload/devtools/fullscreen/open-browser/open-logs/about 保持可用）。
实现时先通读 ipc.rs 再落位；`Cargo.toml` 已有 url 依赖则直接用，否则用字符串前缀比较。

- [ ] **Step 2.3 chrome_init 加诊断字段**：返回 Value 里补 `\"desktopShell\": \"tauri\"`。
- [ ] **Step 2.4 验收**：`cd tauri-app && cargo check && cargo test` 绿；
  debug 构建启动后（CDP）在远程页 console 执行 `window.__TAURI__.window.minimize()` 应被拒；
  标题栏按钮（走自有命令）正常；recovery/loading 本地页功能正常。

## Task 3（V-C）：真机验证 + 基线度量〔采纳项 E〕

- [ ] **Step 3.1 启动**（Git Bash 或 PowerShell 设环境变量）：

```bash
cd tauri-app && export PATH=\"$HOME/.cargo/bin:$PATH\" && cargo build
DSH_DESKTOP_USERDATA=/tmp/dsh-v_userdata DSH_HOME=/tmp/dsh-v_home \
DSH_DESKTOP_TEST_NO_SHORTCUTS=1 DSH_DESKTOP_SKIP_PLUGIN_UPDATE=1 \\
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \\
./target/debug/dsh-desktop-lite.exe
```

（首启全新 DSH_HOME 要装依赖，boot 超时 180s，耐心——坑⑪）

- [ ] **Step 3.2 CDP 点检**（Node24 全局 fetch/WebSocket 直连 `http://127.0.0.1:9222/json`，
  写一次性脚本 `scripts/vc-check.mjs` 输出点检表）：窗口出现、标题栏图标/徽标渲染、
  Web UI 加载完成、能定位对话输入框、皮肤/插件页可达、心跳存活。
  人工项（请用户确认）：菜单开合、最小化/最大化、托盘显隐、重启 Web 服务。
- [ ] **Step 3.3 退出无残留**：关窗退出后 `tasklist | findstr /i \"node.exe conhost.exe dsh-desktop-lite.exe\"` 为空。
- [ ] **Step 3.4 真实 DSH_HOME 复跑关键路径**（先确认 Electron 版未运行，防互踩）。
- [ ] **Step 3.5 度量写入 `docs/tauri-migration-baseline.md`**：两版冷启动→UI 就绪 ms
  （desktop.log 首末时间戳）、空闲工作集 MB（Get-Process）、退出残留进程数。
  安装包体积待 V-D 后补记。

## Task 4（V-D）：打包

**Files:**
- Create: `tauri-app/scripts/stage.ts`（新代码一律 TS；package.json build 脚本改引 stage.ts，
  以 `node --experimental-strip-types scripts/stage.ts` 运行或先用 tsc 编译后调用）
- Modify: `tauri-app/nsis/installer-hooks.nsh`
- Modify: `scripts/make-release-hashes.js`、`scripts/verify-dist-fresh.js`（适配产物路径）

- [ ] **Step 4.1 stage.ts**：产出 `tauri-app/resources/{app,node,npm}`：
  app = package.json + 生产依赖闭包 node_modules
  （`npm ls --omit=dev --all --parseable` 求闭包拷贝，含传递依赖 js-yaml）+
  根 JS（当前阶段仍拷 shell-host/desktop-core/updater/plugin-*/balance/preset-sync/
  builtin-collision/patch-row-heal/profile-module-heal/plugin-manager-state/
  koffi-preflight + scripts/{koffi-preflight.cjs,plugin-manager-patch.js}）+
  assets/** + bundle-manifest.json（按 `src/integrity.rs` build_bundle_manifest 同口径：
  遍历计数 + sha256，用 node:crypto 实现；实现前先读 integrity.rs 对齐清单格式）。
  node/npm 目录来自 vendor/fetch-runtime 产物布局。
- [ ] **Step 4.2 NSIS hooks 完整移植**：读 `build/installer.nsh`，三代 exe taskkill、
  MAX_PATH 嵌套治愈、自定义运行中检测移植进 `nsis/installer-hooks.nsh`；
  把 `installer-nsh-*` 三个测试改造为对新 hooks 的断言。
- [ ] **Step 4.3 SHA256SUMS 与 verify-dist-fresh 适配**新产物布局。
- [ ] **Step 4.4 验收**：`npm run build`（tauri-app）产出安装包；
  本机安装到临时目录 + DSH_DESKTOP_USERDATA 重定位跑 V-C 点检；
  覆盖安装 → 数据保留、无嵌套目录。基线文档补安装包体积。

## Task 5（V-E）：localStorage 迁移〔采纳项 D〕

⚠️ **前置用户决策**：Electron 导出端需要给 main.js 退出路径做一次**纯增量**修改
（v2 计划已明文包含此项，属冻结例外；动手前必须再次向用户确认）。
替代方案（若拒绝改动）：Tauri 首启检测不到导出文件时提示用户手动导出，跳过自动迁移。

- [ ] **Step 5.1** Electron main.js：退出前把 `http://127.0.0.1:<webPort>` origin 的
  localStorage 导出 `%APPDATA%/<app>/migration-localstorage.json`（0600）。
- [ ] **Step 5.2** Rust boot：检测该文件且无完成标记 → Web UI 首次加载后
  initialization_script eval 写入 → 抽样键校验 → 写 `migration-done` 标记 → 删明文文件。
- [ ] **Step 5.3 验收**：Electron 版改过的会话分组/侧栏偏好在 Tauri 版首启后仍在。

## Task 6（V-T）：sidecar 轨道 TypeScript 化

### 6.0 忠实移植规约（每个移植任务的质量门）

1. 逐函数对照原 JS；控制流、条件顺序、错误吞没行为、**日志文本逐字节一致**；
2. 不“顺手优化”、不改命名对外的 RPC 方法名/参数/响应形状；
3. 类型化原则：DI ctx（log/notify/settings 路径）定义接口；settings 动态字段用
   `unknown` + 窄化或索引签名，镜像 serde_json Value 容忍未知字段的语义；
4. 只用可擦除 TS 语法（无 enum/namespace/参数属性），保证 node 原生 strip-types 可跑测试；
5. 每个文件移植完：`npx tsc --noEmit` 过 + 对应单测过 + 与原 JS 并排 diff 自审。

### 6.1 脚手架

**Files:** Create `sidecar/tsconfig.json`、`sidecar/build.mjs`、`sidecar/.gitignore`；
Modify 根 `package.json`（scripts 加 `sidecar:check`/`sidecar:build`/`sidecar:test`）、`.gitignore`

```jsonc
// sidecar/tsconfig.json
{
  \"compilerOptions\": {
    \"target\": \"ES2022\", \"module\": \"commonjs\", \"moduleResolution\": \"node\",
    \"strict\": true, \"noUncheckedIndexedAccess\": true, \"esModuleInterop\": true,
    \"skipLibCheck\": true, \"outDir\": \"dist\", \"rootDir\": \"src\", \"sourceMap\": false,
    \"types\": [\"node\"]
  },
  \"include\": [\"src/**/*.ts\"]
}
```

```js
// sidecar/build.mjs —— tsc 多文件 emit 包装
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, [require.resolve('typescript/lib/tsc.js') , '-p', new URL('.', import.meta.url).pathname], { stdio: 'inherit' });
```

（tsconfig `noEmit:false` 直接 emit；类型快检脚本用 `tsc --noEmit`。）

- [ ] 单测链路：`node --test \"sidecar/test/*.test.ts\"`（Node24 原生 strip-types）。
- [ ] 契约测试暂不动（Task 6.末才切目标）。

### 6.2~6.13 模块移植（顺序：叶子 → 关键 → 入口）

| 序 | 目标 | 源 | 单测来源 |
|---|---|---|---|
| 6.2 | lib/plugin-manager-state.ts | plugin-manager-state.js | 移植旧用例核心断言 |
| 6.3 | lib/builtin-collision.ts | builtin-collision.js | 同上 |
| 6.4 | lib/profile-module-heal.ts | profile-module-heal.js | 同上 |
| 6.5 | lib/patch-row-heal.ts | patch-row-heal.js | patch-row-heal 相关旧用例 |
| 6.6 | lib/plugin-guard.ts | plugin-guard.js | 保护中心契约测试兜底 |
| 6.7 | lib/balance.ts | balance.js | 余额契约测试兜底 |
| 6.8 | lib/preset-sync.ts | preset-sync.js | preset-sync 旧用例移植 |
| 6.9 | lib/plugin-updater.ts / lib/updater.ts | plugin-updater.js / updater.js | updater 工具函数用例 |
| 6.10 | lib/koffi-preflight.ts | koffi-preflight.js | koffi 缺席路径用例 |
| 6.11 | lib/plugin-manager-patch.ts | scripts/plugin-manager-patch.js | patch 操作幂等用例 |
| 6.12 | src/desktop-core.ts | desktop-core.js | 契约测试兜底 |
| 6.13 | src/shell-host.ts | shell-host.js | stdin EOF/未知方法契约 |

每步：读源 JS → 建 TS（规约 6.0）→ `sidecar:check` → 该模块单测 → 下一个。

### 6.14 接线切换

- [ ] boot.rs/sidecar 启动路径改指 `sidecar/dist/shell-host.js`
  （dev=仓库根下相对路径；packaged=resource/app 同相对布局，stage.ts 改拷 dist 树）；
- [ ] `test/sidecar-rpc.test.mjs` 的 HOST 常量改指 `sidecar/dist/shell-host.js`；
- [ ] 根目录旧 .js 保持原样（冻结轨道继续用）。

### 6.15 全量复验（V-T 完成定义 = 设计文档 §七）

- [ ] `npm run sidecar:build && npm test` 连续 3 次绿（两预存失败除外）；
- [ ] `cargo check && cargo test` 绿；
- [ ] debug 构建 + 重定位目录真机点检清单全过（对照 V-C 记录逐项）；
- [ ] 更新 handoff 文档的命令速查与新布局说明。

## 执行方式

本会话内联执行（红线条目多、验证依赖本机真机交互，子代理缺乏会话上下文）。
每完成一个 Task 向用户汇报实测结果后再进入下一个。

**范围外**：V-F（preview 发布与 14 天观察）与 V-G（切换默认+README 重写+归档删除 Electron）
属发布运营与观察期工作，待 V-T 复验通过后另行执行；本计划覆盖至 V-T 全量复验为止。

# DSH Lite → Tauri + Rust + TS 迁移：交接报告

> 写于 2026-08-21。供接手者（人或模型）继续执行。当前分支 `lite-Windows`。
> 配套记忆索引：`C:\Users\HUAWEI\.zcode\cli\memories\projects\dsh-lite-3d524f2725a7d635\memory\`
>
> **⚠ 计划以 v2 为准**：外部建议稿（plan-rebuild.md）已评估融合，采纳 7 项/拒绝 8 项，
> 剩余工作按阶段 V-A~V-G 执行 —— 见 **`docs/tauri-migration-plan-v2.md`**。
> 本文其余部分（架构/文件清单/命令速查/技术坑）仍然有效。

---

## 1. 背景与已批准方案

用户批准了对原 Electron 应用（`dsh-desktop-lite` 4.4.0，DeepSeek Harness dsh CLI 的 Windows 桌面壳）的**混合渐进式**迁移：

- **动机**：体积/内存、安全攻击面、技术栈现代化。
- **策略**：Tauri v2 / Rust 只重写壳层（窗口/托盘/进程管理/IPC/可靠性），约 4000 行插件生态 JS 逻辑（plugin-guard/plugin-updater/sync/heal 等）**原样复用**，装进 Node sidecar 经 stdio JSON-RPC 由 Rust 编排。220+ 现有 JS 测试保值。
- **平台**：继续 Windows-only。
- **总工作量估计**：全职单人 8~10 周；本次会话已完成约 70%（全部代码 + 单测，剩打包与真机验证）。

### 目标架构

```
┌─ Tauri v2 壳（Rust，tauri-app/）────────────────────────┐
│ 无边框窗口(WebView2)+注入chrome、托盘、单实例、导航锁定、   │
│ spawn 内置node.exe跑dsh web、stable-port、HTTP探测竞争、   │
│ Job Object 进程树查杀、守护启动循环、看门狗(同exe再入)、    │
│ 恢复状态机(心跳+探活)、bundle完整性、预览静态服务、         │
│ TaskDialog原生对话框、快捷方式维护(PowerShell .lnk)        │
└──────┬──────────────────────────┬───────────────────────┘
       │ loadURL                  │ stdio 行式 JSON-RPC
┌──────▼───────┐          ┌───────▼─────────────────────┐
│  dsh Web UI  │          │ shell-host.js (sidecar)      │
│ (远程页面)    │          │  ├─ dsh web 服务（Rust spawn）│
└──────────────┘          │  └─ desktop-core.js 编排现有  │
                          │     JS 模块(guard/updater/    │
                          │     balance/preset-sync/...)  │
                          └───────────────────────────────┘
```

---

## 2. 环境与工具链（本机已就绪）

| 组件 | 状态 |
|---|---|
| Rust | 1.98.0 stable-msvc（rustup 装于 `~/.cargo/bin`，Git Bash 里需 `export PATH="$HOME/.cargo/bin:$PATH"`） |
| MSVC | BuildTools 在 `D:\VS2022\BuildTools`（vswhere 可定位） |
| WebView2 | 151.0.4129.93 已安装 |
| Node/npm | v24.11.1 / 11.6.2 |
| tauri-app 依赖 | `@tauri-apps/cli`、`esbuild`、`typescript` 已装 |

---

## 3. 已完成工作（文件清单）

### 3.1 Rust 壳层（`tauri-app/`）——编译通过，12 个单测全绿

| 文件 | 内容 |
|---|---|
| `Cargo.toml` | tauri 2.11（features: tray-icon/devtools/image-png）、windows 0.58（JobObjects/Threading/Time/UI_Controls/Security）、tiny_http；release profile opt-size |
| `tauri.conf.json` | productName "Deepseek Harness EAC v4Lite"、identifier com.deepseek.dsh.desktop.lite、NSIS 目标、resources glob `resources/**/*`、webviewInstallMode downloadBootstrapper、frontendDist ./frontend、beforeDevCommand=build:inject |
| `capabilities/main.json` | 本地+远程(`http://127.0.0.1:*`)上下文；core 窗口/事件权限。**注意：应用自有命令在 Tauri v2 不受 ACL 限制，裸 allow-* 会构建报错** |
| `src/main.rs` | 入口；`--dsh-watchdog` 参数时进入看门狗模式（同 exe 再入） |
| `src/lib.rs` | Builder 装配：single-instance/notification/clipboard 插件、22 个命令注册、setup（AppState/托盘/主窗/preview/recovery 定时器/boot 启动）、CloseRequested 三档关闭流、ExitRequested 有界清理→exit(0)、RunEvent::Exit 兜底杀树 |
| `src/state.rs` | AppState（Arc 管理）：paths/log(Arc)/sidecar/service/web_url/quitting/recovery/balance_cache/picker_overlay/tray_ready/app(OnceLock<AppHandle>)；notify() 走 notification 插件 builder() |
| `src/paths.rs` | dev=仓库根(CARGO_MANIFEST_DIR/..)，packaged=resource_dir/app；DSH_HOME 默认 ~/.dsh-v4lite；DSH_DESKTOP_USERDATA 可重定位 userData |
| `src/logging.rs` | desktop.log，行格式与 Electron 版一致（本地时间+UTC偏移）；GetTimeZoneInformation 取偏移 |
| `src/settings.rs` | settings.json 直读直写（无缓存！sidecar 与壳双端写）；serde_json Value 保未知字段；原子写 tmp+rename；exit_action_of/shortcut_policy_of 兼容旧 closeToTray 迁移 |
| `src/port.rs` | Chromium 受限端口表、restricted_port_of、extract_port（含 IPv6/协议默认端口）、choose_stable_web_port（复用 settings.webPort） |
| `src/netprobe.rs` | 手写 HTTP GET 探测（status<500 即就绪），零依赖 |
| `src/procwin.rs` | taskkill 两段式（优雅→/F）、kill_tree_and_wait 有界回收、JobHandle(newtype unsafe Send) + assign_job(KILL_ON_JOB_CLOSE)、spawn_detached |
| `src/service.rs` | start_server：spawn node.exe --use-system-ca dsh --profile web-desktop --host --port [--patch overlays]、env 清理(DSH_WEB_URL等6项)+注入(DSH_HOME/DSH_DESKTOP/NO_COLOR)、stdout 就绪行正则解析、HTTP 探测线程竞争、受限端口递归重启≤4次、首启180s/稳态60s超时、退出监视线程(exited 标志)；返回 (StartOutcome, Receiver) 供调用方继续监视意外退出 |
| `src/sidecar.rs` | stdio JSON-RPC 客户端：读线程分发响应/事件(log/notify/balance/exited)、call/call_timeout、kill()（关stdin自然退出+taskkill兜底） |
| `src/boot.rs` | boot_chain 全链路（run_state/watchdog/unclean检测/sidecar启动+事件泵/profile.migrateAndSync/koffi.preflight/junction巡检5min/integrity校验/guarded_start/收尾shortcuts+balance循环+updates循环）；guarded_start=guardedBoot 移植（Rust 持重试/回滚决策树，sidecar 持快照/体检/修复/allowBuilds/事故原子操作）；handle_boot_failure 对话框链（停用插件/回滚快照/回退上一版本/回退内置/重试/退出，按钮下标显式计算）；restart_service_core 原地重启；on_service_died「DSH 服务已停止」对话框；create_main_window（decorations:false + initialization_script + on_navigation 导航锁定(origin精确比较) + on_page_load 恢复跟踪） |
| `src/ipc.rs` | 22 个命令逐一映射 Electron IPC：renderer_heartbeat/page_error/chrome_init/chrome_window/chrome_menu(reload/devtools/fullscreen/open-browser/open-logs/toggle-close-to-tray/set-exit-action/restart-service/toggle-shortcut-policy/about/quit)/chrome_restart_service/guard_action/plugin_list/plugin_set_enabled/plugin_set_removed/plugin_updates/plugin_update/plugin_auto_update/balance_refresh/balance_prices_get|set|reset/open_external/recovery_state|reload|restart|open_logs；base64_lite_encode 图标 dataURI |
| `src/dialog.rs` | TaskDialogIndirect（自定义按钮/勾选框/TD_*_ICON 负值 HICON/IDCANCEL 映射最后按钮对齐 Electron cancelId；cancellable=false 禁 Esc/X）；MessageBoxW 兜底；build_error_detail |
| `src/recovery.rs` | 紧凑恢复状态机：心跳丢失45s+服务探活失败双信号 → compute_backoff/next_action（参数与 JS 版一致）→ reload/rebuild/give-up→recovery.html；4 个单测 |
| `src/watchdog.rs` | run_as_watchdog 轮询父PID（cleanExit/新实例接管/10min内≤5次拉起/15s宽限）；write_run_state/mark_clean_exit/detect_unclean_previous_run/iso_now |
| `src/integrity.rs` | count_files/build_bundle_manifest/verify_bundle（issue #7 语义）；2 个单测 |
| `src/preview.rs` | 只读静态文件服务（仅回环/GET|HEAD/绝对路径/MIME表/no-store）；端口存 PREVIEW_PORT AtomicU16 |
| `src/shortcuts.rs` | maintain_shortcuts 经 PowerShell WScript.Shell 读写 .lnk：开始菜单必维护、桌面 policy=never 不建、target-moved/icon-version 刷新只动「属于本应用」的、用户自定义图标不覆盖、DSH Desktop 旧名清理 |
| `frontend/chrome.ts` | preload.js 完整移植为 initialization script：window.dshDesktop 同形状桥（invoke/event 实现）、36px 玻璃标题栏 DOM（data-tauri-drag-region 拖拽）、心跳5s、page-error 转发、dsh:balance→CustomEvent、F11/F12/Ctrl+R/Ctrl+Shift+I、window.open 与 target=_blank 转系统浏览器 |
| `build-inject.mjs` | esbuild 把 chrome.ts 打成 `src/inject/chrome.js`（Rust include_str! 内嵌）——**改了 chrome.ts 必须重跑 `npm run build:inject`** |
| `frontend/` | loading.html/recovery.html/icon.png 从 assets/ 复制（loading body 加了 data-tauri-drag-region） |
| `nsis/installer-hooks.nsh` | 最小版（PREINSTALL taskkill 本代+旧代 exe）；**完整移植是待办** |

### 3.2 JS sidecar（仓库根）

| 文件 | 内容 |
|---|---|
| `desktop-core.js` | main.js 插件生态逻辑整体迁出（~900行）：COMPANION_PLUGINS(10项)/CORE_PLUGIN_IDS/PLUGIN_UPDATE_SOURCES 常量、ensureDesktopProfileInit、copyPluginPackage(V4戳记跳过)/pluginStampOf/pluginCopyEntries、migrateFromSharedWebProfile/applyLegacySkinChoice/removePatchRowsById、syncCompanionPlugins(preset同步/同名迁移接管/皮肤9款/内置清单标记/patch幂等注册/issue#16 dedup)、healProfileModules、processPendingMarketOps(排队任务/artifact keep/allowBuilds重试一次)、pluginManagerCollect/SetEnabled/SetRemoved/restoreCompanionPlugin、refreshBalance/pricesGet|Set|Reset、updatesCheck/List/UpdateOne/SetAutoUpdate、koffiPreflight、junctionTick+detectExternalDsh、guardAction 分发、guardAllowBuildsPreRetry。全部 DI（log/notify 注入），不 require electron |
| `shell-host.js` | RPC 服务壳：argv 解析（**支持 `--x=v` 和 `--x v` 两种形式**）、NODE_EXE/NPM_CLI 双布局探测（打包 ../node 平级 / dev vendor/）、方法表 ~30 个方法、stdin EOF 自然退出、uncaughtException 上报 |

### 3.3 测试

| 文件 | 状态 |
|---|---|
| `test/sidecar-rpc.test.mjs` | 新增，7 个契约测试全绿：ready事件/未知方法错误、profile初始化+插件落盘、保护中心快照回滚体检事故闭环、插件管理list/禁用/移除、余额价格读写、排队标记解析、stdin EOF退出。**注意断言读业务层 `r.result.ok`（传输层 ok 恒 true）** |
| Rust 单测 ×12 | port/netprobe/service(ready行解析)/recovery(backoff/action梯子/计数/retry_now)/integrity 全绿 |
| 原有 JS 套件 | 257 用例 255 绿；**2 个失败是预先存在的**（见 §5） |

---

## 4. 构建 / 运行 / 测试命令速查

```bash
cd "D:\dsh lite"

# JS 全量测试（原有220+ + sidecar契约7个）
npm test

# 只跑 sidecar 契约测试
node --test test/sidecar-rpc.test.mjs

# Rust 检查/测试（Git Bash）
cd tauri-app && export PATH="$HOME/.cargo/bin:$PATH"
cargo check && cargo test

# 重新生成注入脚本（改 frontend/chrome.ts 后必须）
npm run build:inject

# 开发运行（会起 tauri dev）
npm run dev

# debug 构建产物（验证用）
cargo build
./target/debug/dsh-desktop-lite.exe
```

**验证运行时的关键环境变量**：
- `DSH_DESKTOP_USERDATA=<dir>` 重定位 userData（别污染真实 %APPDATA% 数据）
- `DSH_HOME=<dir>` 重定位数据主目录（默认 ~/.dsh-v4lite）
- `DSH_DESKTOP_TEST_NO_SHORTCUTS=1` 跳过快捷方式维护
- `DSH_DESKTOP_SKIP_PLUGIN_UPDATE=1` 跳过插件更新定时器
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 开 CDP（界面自动化验证用；Node24 自带全局 WebSocket/fetch 可直连 `http://127.0.0.1:9222/json` 驱动）
- dev 模式自动用仓库根作为 appRoot（vendor/node_modules/assets 原地解析），无需 staging

---

## 5. 验证状态与已知问题

### 5.1 已验证 ✅
- Rust 编译零错误、12 单测绿
- sidecar 手动端到端：ready 事件 → profile 初始化 → preset×3 安装 → 10 插件+9 皮肤同步落盘 → RPC 响应
- 契约测试 7/7（隔离运行稳定）
- JS 套件 255/257

### 5.2 预先存在的失败（**不是本次迁移造成，不要顺手修**）
- `preset-sync.test.mjs` 中「minimal-gitbash 缺 preset.yml」「minimal-win 缺 preset.yml」：这些 preset 目录在**本会话开始前**就被有意删除（git status 里的未暂存删除），测试没跟上裁剪。属于用户在做的 v4Lite 清理，由用户决定改测试还是恢复文件。

### 5.3 当前卡点：sidecar 契约测试在全量并发跑时偶发失败 ⚠️
现象：隔离跑 7/7 绿；`npm test` 全量并发时偶现 1~2 个失败，两种表现：
1. `profile 初始化` 断言 patch=/id: balance/ 失败，实际内容 `'[]\n'` —— 说明 `syncCompanionPlugins` 走到了内部 catch（它永不抛出，只记日志 `同步配套插件失败: ...`）
2. `保护中心` healthCheck 未发现 PATCH_DUP_ID —— 同一次 sync 异常的连锁

已准备但**尚未接线**的诊断手段：`test/sidecar-rpc.test.mjs` 顶部已有 `withLogs` 辅助函数（把 s.events 尾部日志附到断言错误里），需要把它包到两个偶发测试体上，然后 `npm test` 复现，看 sidecar 日志里的真实异常。

怀疑方向（按可能性）：
- 并发大量文件复制触发的 Windows 文件锁/AV 干扰（copyPluginPackage 拷 assets 下大目录）
- EMFILE/EPERM 类瞬时错误被 catch 吞掉（日志会显示）
- node:test 多进程并发下的 tmpdir/句柄压力

修复思路候选：sync 内部对 copy 类操作加有限重试；或测试降低并发（`node --test --test-concurrency=...`）；或找到根因后精准修。

### 5.4 尚未做的大项
1. **真实运行验证**（用户明确要求）：cargo build → 设上述环境变量启动 → CDP 连 WebView2 → 点检：窗口出现、标题栏图标/徽标渲染、菜单能开、最小化/最大化按钮、托盘存在、dsh Web UI 加载、能点击对话输入、皮肤/插件页、重启 Web 服务、退出无残留 node.exe（tasklist 查）。注意：若机器上有 Electron 版在跑，先关掉（两者共用 DSH_HOME 会互踩 profile——这正是 v4Lite 隔离设计要防的）。
2. **P5 打包**：`tauri-app/package.json` 的 build 脚本引用了 `scripts/stage.mjs`——**该脚本还没写**。职责：staging 出 `tauri-app/resources/{app,node,npm}`（app=package.json+生产依赖闭包 node_modules（可用 `npm ls --omit=dev --all --parseable` 求闭包）+根 JS 模块+scripts/+assets/+shell-host.js/desktop-core.js+bundle-manifest.json（调 integrity.buildBundleManifest 等价逻辑，可借 node 脚本生成））；NSIS hooks 完整移植（参照 `build/installer.nsh`：三代 exe 清理/MAX_PATH 嵌套治愈/自定义运行中检测，对应测试 installer-nsh-* 要改造）；SHA256SUMS 脚本适配；verify-dist-fresh 适配新产物路径。
3. **文档**：README 增加 Tauri 架构说明与行为差异表（displayBalloon→Toast、快捷方式 AUMID 未写进 .lnk、devtools 需 release 带 devtools feature 已开）。

---

## 6. 关键技术决策与坑（接手必读）

1. **Child.pid 字段已被新版 Rust 移除**：一律用 `child.id()`。
2. **windows crate 0.58**：CreateJobObjectW 需要 `Win32_Security` feature；TASKDIALOGCONFIG 的图标在 `Anonymous1.hMainIcon`（HICON 负值 MAKEINTRESOURCE：warning=-1/error=-2/info=-3），**没有 nCancelButtonId 字段**——取消语义靠 IDCANCEL(2) 返回值映射到最后一个按钮；BOOL 在 `Win32::Foundation` 不在 core。
3. **tauri State<T> 的 .clone() 克隆的是引用**——跨线程要用 `state.inner().clone()` 拿 Arc。
4. **Tauri v2 应用自有命令不受 ACL 管**：capabilities 里写裸 `allow-xxx` 会构建失败；远程页面权限靠 capability 的 `remote.urls`（`http://127.0.0.1:*`）。
5. **settings.json 无缓存**：Rust 与 sidecar 双端写，必须直读。
6. **RPC 两层 ok**：传输层 `{id,ok,result|error}` 与业务层 result 里的 ok。Rust `sidecar.call()` 返回的就是业务 Value。
7. **include_str!("inject/chrome.js")**：cargo 构建前必须存在该文件（build-inject.mjs 产出）；直接 cargo check 前先跑 `npm run build:inject`。
8. **dev/packaged 路径分叉**在 `paths.rs`：`cfg!(debug_assertions)` 为 false 即视为 packaged（用 resource_dir）。所以**验证请用 debug 构建**（原地用仓库根），release 裸跑会找不到资源。
9. **Job Object**：KILL_ON_JOB_CLOSE 保证壳崩了 dsh web 树也被内核回收；HANDLE 非 Send，用 `procwin::JobHandle` newtype。
10. **恢复状态机是简化版**：Electron 的 render-process-gone/unresponsive 事件 WebView2 拿不到，改用心跳丢失+HTTP 探活双信号驱动同一决策梯（backoff/rebuild/give-up 参数与 JS 版一致）。
11. **boot 超时**：首启 180s（profile 要 pnpm 装依赖）/稳态 60s；验证全新 DSH_HOME 时第一次启动要耐心。
12. **desktop-core.js 各函数内部吞错记日志**（对齐 main.js 行为）——排查问题看 desktop.log / sidecar 日志事件，不要假设它会向上抛。

## 7. 明确不要动的东西

- `assets/`（78K 行插件/皮肤/presets 资产）零改动
- dsh 上游 CLI（node_modules/@deepseek-ai/*）
- Electron 版代码（main.js 等）保持冻结双轨，直到 Tauri 版验收
- §5.2 的两个预存测试失败（用户自己的裁剪进行中）

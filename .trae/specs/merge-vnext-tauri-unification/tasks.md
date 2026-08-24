# Tasks · VNext × Tauri 统一合并

> 纪律（沿用 refactor-modular-architecture 实战约定）：
> 1. 每个 Task 完成门禁：`npm run typecheck` 零错 + `npm test` 全绿 + `cargo test` 全绿（Task 9 起 Linux 相关另跑平台单测）→ 独立 git commit（只 add 本任务文件）。
> 2. **禁止删测试降绿**：测试数量变化须在 commit message 列出逐条理由。
> 3. 同时间只有一个 Task 在改共享文件；Task 0-4 严格顺序；Task 5-8 内批次顺序执行。
> 4. 冲突解决以主文档 `.trae/documents/merge-vnext-tauri-unification.md` §6 解决表为唯一依据。
> 5. 平台分支统一写法：`const IS_WIN = process.platform === 'win32'`（Rust 侧 `#[cfg(windows)]`/`#[cfg(unix)]`）。

- [x] Task 0: 集成分支与合并骨架（完成于 merge commit `d64d7f5`）
  - [x] 0.1 `git checkout main && git checkout -b merge/vnext-tauri`；记录基线（main HEAD = fe299dd）
  - [x] 0.2 `git merge refactor/vnext-ts-isolation --no-ff`（实际 64 个未解决条目；预分析 72 处含 rename 源/目标对拆分，无遗漏）
  - [x] 0.3 树级批量解决：`picturereader` 整树取 main 3.1.0（238 文件）、`qq-group-qrcode.jpg`、三处 LICENSE（dsh-compact/file-drop-eac/settings-scroll-fix）取 main、`dsh-settings-nav-custom/lib/client.js` 取 main
  - [x] 0.4 package-lock.json 粗取 refactor 侧（与 package.json 粗取 refactor 一致自洽）；**Task 1 deps 并集后重建**
  - [x] 0.5 `git status` 零未解决 + 全树零冲突标记核验通过 → merge commit `d64d7f5`
  - 执行偏差记录：① wsl-backend.js/.ts 按 refactor 删除（核实 main 侧无代码消费、refactor 升级契约测试断言其属 legacy 已删清单）；② 旧插件 webui-market/zat-dsh-engine/file-drop/auto-compact/plugin-marketplace/tool-vision/tdai-memory 由合并自动删除（main 侧删除胜出），**Task 2.2 大半已完成**；③ `dsh-eac-core-bridge` 改为**保留**（refactor 新增且被 `plugin-registry-data.ts` + `extension-host/bridge-server.ts` 活跃引用，非退役插件）；④ 已知遗留：`plugin-registry-data.ts` 残留 4 条已删插件引用（webui-market/zat-market/auto-compact/file-drop）→ Task 2.3 清理

- [x] Task 1: 配置与文档冲突解决（§6-A/B 组）
  - [x] 1.1 `.github/workflows/ci.yml`：refactor 版基底（Node26+cargo+native）并入 main paths 过滤（`.agents/skills/**`）+ `merge/vnext-tauri` 分支触发 + validate-skill 双 PowerShell 步骤恢复
  - [x] 1.2 `.github/workflows/release.yml`：取 main 禁用占位版（Task 10 删除）
  - [x] 1.3 根 `.gitignore` + `dsh-desktop/.gitignore`：refactor 版 + main 条目并集（desktop 侧 refactor 通配符 `/*.js`+`/lib/**/*.js` ⊇ main 枚举清单；main 的 `tauri-shell/sidecar/server.js` 条目为无效相对路径，由 `tauri-shell/.gitignore` 正确覆盖）
  - [x] 1.4 `README.md`/`README.en.md`：main 版基底，下载链接占位待 Task 11 更新为 Tauri 双平台产物
  - [x] 1.5 `dsh-desktop/package.json`：deps 全取 main（0.1.1-rc.2 全家桶）+ refactor devDeps 并入；scripts 取 refactor；version 6.0.0；package-lock 重建（`npm install --package-lock-only`）；`CHANGELOG.md` 按 6.0.0 双主线版本史改写；`tsconfig.json` 见 1.6；`electron-builder.yml` 无冲突（main 冻结态保留）；`dsh-desktop/README.md` 无冲突
  - [x] 1.6 门禁全绿 → commit。**决策修正**：tsconfig **不并入** `../tauri-shell/sidecar/**`——sidecar/server.ts 仍 mount main 侧 `lib/desktop/*` 布局（`mount('proc')` 等 13 处），与 refactor `lib/*` 37 模块不匹配，并入即 typecheck 崩；sidecar include 与 `lib/desktop` 排除项一并随 **Task 3.5**（sidecar 依赖签名核对/重写）落地。附带修复：`test/file-drop-core.test.ts` 适配 `dsh-file-drop-eac`（旧 `dsh-file-drop` 插件已随合并删除，测试原指向旧路径加载失败；核心 API 同构：classifyFile/buildTextInsertion/buildPathHint/looksBinary/TEXT_MAX_BYTES，仅 id 与暴露名 `__dshFileDropEacCore` 不同）
  - 执行偏差记录：① `node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js`（git 跟踪的补丁文件）曾被 npm install 重装 rc.2 覆盖丢失补丁，已从 HEAD 恢复（该文件 rc.7/rc.2 内容除补丁外一致，且补丁不受 patch-deps.js 管理）；② 本地首次 `npm test` 挂起系 6 个遗留 `electron/install.js` 进程（旧 npm install 下载卡死）阻塞 worker，清理后 dist 已完整无需重下；③ 测试基线 558/558 全绿（refactor 侧 499 → 合并后 558，增量来自 main 侧 client-update 系列等已并入测试）

- [ ] Task 2: 插件资产冲突与旧插件清理（§6-C 组）
  - [ ] 2.1 确认 picturereader 树已取 main 3.1.0（Task 0.3 已完成，238 文件）；`node_modules` 210 文件无冲突残留
  - [ ] 2.2 ~~删除 refactor 独有旧插件~~ 已由 Task 0 合并自动完成：webui-market/zat-dsh-engine/file-drop/auto-compact/plugin-marketplace/tool-vision/tdai-memory 随 main 删除胜出清场；`dsh-eac-core-bridge` 经核实为 refactor 新增且被活跃引用，**保留**
  - [ ] 2.3 注册表清理：`plugin-registry-data.ts` 删除 4 条已删插件条目（`dsh-market-plugin`/`zat-market`/`auto-compact`/`file-drop`，含 line 106 npm 源映射）；`grep -r "dsh-webui-market\|zat-dsh-engine\|dsh-auto-compact\|dsh-plugin-marketplace\|dsh-tool-vision\|dsh-tdai-memory" dsh-desktop/lib dsh-desktop/scripts` 零引用；补注册表一致性测试（无 dir 指向不存在目录的条目）
  - [ ] 2.4 门禁全绿 → commit

- [ ] Task 3: 根模块与测试冲突解决（§6-D/E/F 组）
  - [ ] 3.1 删 .js 侧：`main.js`/`client-updater.js`/`updater.js`/`plugin-guard.js`/`wsl-backend.js`（refactor .ts 为唯一源）
  - [ ] 3.2 add/add 根模块 .ts（balance/builtin-collision/bundle-integrity/error-detail/koffi-preflight/patch-row-heal/plugin-manager-state/session-watcher/profile-module-heal）：取 refactor 版
  - [ ] 3.3 content 类（plugin-updater/preset-sync/preload/chrome/stable-port/watchdog/session-encoding-heal/scripts 六个/test 四个）：refactor 版基底
  - [ ] 3.4 删 `.test.mjs` 两处（client-updater-apply/recovery-integration）：先确认 refactor .ts 等价覆盖，不足则先补测试再删
  - [ ] 3.5 sidecar 依赖签名核对：`resolveRepos`/balance API/updater API/plugin-updater API 逐一对齐（refactor 导出面 ⊇ main 消费面）→ 门禁全绿 → commit

- [ ] Task 4: main 修复移植（11 项，§7 清单；每项先写失败测试再移植——见 tdd.md T1-T11）
  - [ ] 4.1 `lib/server.ts` ← 7f7fa05 并发 dsh web 检测（fix #22，main.js +81 行语义）
  - [ ] 4.2 `lib/plugin-copy.ts` ← 4bc3ac1 安全模式守卫（safeModeActive + patch 行停摆）
  - [ ] 4.3 `lib/plugin-copy.ts` ← a1569b3 schemastery 首启依赖
  - [ ] 4.4 `lib/plugin-copy.ts` ← d268fe9 profile 完整性（tauri 侧 stage-resources 随 main 树自动保留）
  - [ ] 4.5 `plugin-updater.ts` + `scripts/patch-deps.ts` ← 9d068c2/406914e/3f12d05 可选升级字段三连
  - [ ] 4.6 `lib/client-update/*` ← 0d69c79 停滞超时 300s（核对 refactor 现值）
  - [ ] 4.7 核对项：2dd37bd 流写入保护（refactor stream-write-guard 已含）、16b8ff4 splash（资产取 main 自动获得）、18b0fd4 escalation 豁免（定位落点后移植）
  - [ ] 4.8 11be738 托盘完全重启 → 记入 Task 8 清单；每项移植带独立测试 → 门禁全绿 → commit

- [ ] Task 5: 模块统一批次一——sidecar 消费面 ctx 化（12 模块）
  - [ ] 5.1 以 `lib/desktop/guard-box.ts` 的 `XxxCtx` 注入模式为模板建立 `lib/host-ctx.ts`（宿主接口：isPackaged/resourcesPath/log/exitProcess/notify）
  - [ ] 5.2 改造：`lib/proc.ts`（nodeExe/npmCli/updCtx 平台化）、`lib/paths.ts`（fileRoots/desktopProfile）、`lib/server.ts`（spawn 守护）、`lib/boot.ts`、`lib/watchdog-boot.ts`、`lib/plugin-copy.ts`、`lib/plugins.ts`、`lib/plugin-manager-core.ts`、`lib/market-modules.ts`、`lib/market-ops.ts`、`lib/preview.ts`、`lib/shortcuts.ts`
  - [ ] 5.3 Electron main.ts 与 sidecar 双宿主注入适配（过渡期双入口都可用）
  - [ ] 5.4 对应测试夹具改造为 ctx 注入 mock（数量不减）→ 门禁全绿 → commit

- [ ] Task 6: 模块统一批次二——Electron 专属面 ctx 化（其余模块）
  - [ ] 6.1 `lib/state.ts`：mainWindow 概念移除 → bridge 会话句柄；`lib/ipc/sender.ts` 来源校验改 bridge 会话 token
  - [ ] 6.2 `lib/window.ts` 窗口控制语义 → Rust 壳 `win.*` 通道对接层；`lib/tray.ts` 托盘语义 → 事件桥接（实现留 Task 8）
  - [ ] 6.3 `lib/extension-host/*`（manager/rpc/job-fence/sdk）+ `lib/supervisor/*` + `lib/snapshot/*`：state/log 注入化，调度器常驻化
  - [ ] 6.4 `lib/recovery-center/*`、`lib/renderer-recovery/*`、`lib/update-flow.ts`、`lib/onboarding.ts`、`lib/migration.ts`、`lib/balance-ui.ts`、`lib/session-heal.ts` 等其余模块
  - [ ] 6.5 删除 `lib/desktop/*` 14 模块（前置：Task 4 移植清单全部勾选 + §5 映射表逐行核对）→ 门禁全绿 + `grep -r "from 'electron'" lib/ shared/` 零命中 → commit

- [ ] Task 7: sidecar 全量接管 + bridge 扩域
  - [ ] 7.1 `tauri-shell/sidecar/server.ts`：挂载全部统一模块（≥37）+ 全部 IPC 域注册表（chrome:*/dsh:*/snapshot:* 11 域/rc:*/guard:*/onboard:*）
  - [ ] 7.2 `sidecar/bridge.ts`：IPC 域覆盖 36+ 域，语义对齐 `preload/chrome.ts`（invoke/send 双语义保留）
  - [ ] 7.3 `ping.js` → `ping.ts`；sidecar `import x = require()` 改标准 import；tsconfig 编译范围收口
  - [ ] 7.4 snapshot 域集成测试（overview/create/restore 真实调用）；越权会话拒绝测试（见 tdd.md T14）→ 门禁全绿 → commit

- [ ] Task 8: Tauri 壳能力补齐（tauri-shell/）
  - [ ] 8.1 `src/main.rs` 托盘菜单：重启 Web 服务 / 完全重启 / 退出（对齐 11be738 + refactor 托盘项）
  - [ ] 8.2 导航围栏：仅放行 localhost dsh web + 白名单（承接 `lib/window.ts` isAllowedWebUrl 语义）
  - [ ] 8.3 快照备份树面板入口（⋯ 菜单位置对齐 refactor：重启 Web 服务与重新加载之间）；面板经 bridge 拉起
  - [ ] 8.4 splash 主题跟随系统（16b8ff4 语义）；恢复中心三入口在 Tauri 壳可达性核对
  - [ ] 8.5 壳层手动 smoke：`tauri dev` 起壳 → sidecar 起 → dsh web 加载 → 托盘/快照面板可用 → commit

- [ ] Task 9: 平台抽象层（Linux 支持核心）
  - [ ] 9.1 `job-fence.ts` 围栏策略：`fenceMode()` 已有抽象接 Linux 实现；`native/supervisor` Rust 加 `#[cfg(unix)]` PR_SET_PDEATHSIG + setpgid 进程组（对照 `#[cfg(windows)]` Job Object 语义：父子双杀、无孤儿）
  - [ ] 9.2 `main.rs` 平台抽象：资源定位/进程 spawn/隐藏控制台抽 trait（Windows CREATE_NO_WINDOW / Unix 无操作）；`tauri.conf.json` targets 扩展 deb/AppImage
  - [ ] 9.3 node 运行时双平台：`scripts/fetch-node.ts` 适配 linux-x64 下载源；vendor 布局 `vendor/node/bin/node`（Linux）vs `vendor/node/node.exe`
  - [ ] 9.4 Windows 专属面挂分支：junction-patrol / `.lnk` 快捷方式 / 注册表诊断 / NSIS 钩子 / client-update 应用内更新（Linux 走包管理器，更新入口禁用并提示）——各配平台分支单测
  - [ ] 9.5 cargo test 补 Linux 围栏用例（Linux 环境跑）+ 既有用例双平台通过 → 门禁全绿 → commit

- [ ] Task 10: Electron 退役
  - [ ] 10.1 删除：`main.ts`、`preload.ts`/`preload/`、`electron-builder.yml`、`build/installer.nsh`、electron 测试夹具（改造为 sidecar 夹具，数量不减）
  - [ ] 10.2 `package.json`：删 electron/electron-builder devDeps；scripts 收敛 build/typecheck/test/test:native/build:native/clippy:native + tauri 打包链
  - [ ] 10.3 CI：`ci.yml` 重写为 typecheck + cargo test + node 测试 + `tauri build`（双平台 matrix：windows-latest + ubuntu-latest）；删 `release.yml`
  - [ ] 10.4 `release-tauri.yml`：补 native 构建（cargo + napi）与 tag 版本注入步骤；双平台 matrix；产物过滤按平台（承袭项目约束：Windows/Linux × x64）
  - [ ] 10.5 grep 终检：`grep -ri electron package.json dsh-desktop/lib tauri-shell` 零命中 → 门禁全绿 → commit

- [ ] Task 11: 双平台打包链与升级路径
  - [ ] 11.1 Windows：`tauri build` 产出 NSIS Setup.exe + 便携 zip + SHA-256（make-release-hashes 适配）
  - [ ] 11.2 Linux：产出 `.deb` + `.AppImage`（+rpm 若零成本，OQ-1 决议）；AppImage 命名对齐历史规范（OQ-2）
  - [ ] 11.3 Linux 冒烟：干净 Ubuntu 容器内 AppImage 启动 → sidecar → dsh web 加载；`.deb` 安装/卸载
  - [ ] 11.4 升级链脚本：`upgrade-test-441.ts` 适配 + 新增 5.1.0→6.0.0（NSIS installDir 判定 + 升级钩子沿用 main 链）
  - [ ] 11.5 README 下载链接更新为 v6.0.0 双平台产物 → commit

- [ ] Task 12: 性能与安全专项（主文档 §8）
  - [ ] 12.1 性能度量入档：boot 关键路径 ≤500ms 基线回归；sidecar 启动时间对比；安装包体积（Win NSIS 目标 <80MB vs Electron 155MB）；快照创建/磁盘占用基准
  - [ ] 12.2 安全测试落地：bridge 会话 token 越权拒绝；导航围栏恶意 URL 拦截；H2/H3 路径逃逸拒绝（Startup\*.bat 类）；进程树击杀零孤儿；release 禁 devtools 产物核验
  - [ ] 12.3 每项度量/测试结果记录入 `checklist.md` 对应项 → commit

- [ ] Task 13: 终验与合并
  - [ ] 13.1 全量终验：AC-1~AC-16 逐条过（checklist.md 全勾）
  - [ ] 13.2 插件隔离实测（AC-6）：装第三方 SDK 插件 → Host 独立进程 → 强杀验证 → 状态机退避
  - [ ] 13.3 升级链实测（AC-15）：4.4.1→6.0.0 与 5.1.0→6.0.0 端到端
  - [ ] 13.4 push `merge/vnext-tauri`（走 gh-proxy.org）跑 CI 双平台全绿
  - [ ] 13.5 `git checkout main && git merge merge/vnext-tauri --no-ff` 推送；打 `v6.0.0` tag；在线盯跑 release-tauri.yml 首轮（重点：NSIS 时长/缓存行为/双平台产物齐全）

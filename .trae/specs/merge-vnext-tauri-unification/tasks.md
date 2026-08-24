# Tasks · VNext × Tauri 统一合并

> 纪律（沿用 refactor-modular-architecture 实战约定）：
> 1. 每个 Task 完成门禁：`npm run typecheck` 零错 + `npm test` 全绿 + `cargo test` 全绿（Task 9 起 Linux 相关另跑平台单测）→ 独立 git commit（只 add 本任务文件）。
> 2. **禁止删测试降绿**：测试数量变化须在 commit message 列出逐条理由。
> 3. 同时间只有一个 Task 在改共享文件；Task 0-4 严格顺序；Task 5-8 内批次顺序执行。
> 4. 冲突解决以主文档 `.trae/documents/merge-vnext-tauri-unification.md` §6 解决表为唯一依据。
> 5. 平台分支统一写法：`const IS_WIN = process.platform === 'win32'`（Rust 侧 `#[cfg(windows)]`/`#[cfg(unix)]`）。

- [ ] Task 0: 集成分支与合并骨架
  - [ ] 0.1 `git checkout main && git checkout -b merge/vnext-tauri`；记录基线（main HEAD = fe299dd）
  - [ ] 0.2 `git merge refactor/vnext-ts-isolation --no-ff`（预期 72 冲突）
  - [ ] 0.3 树级批量解决（不逐文件读）：`git checkout main -- dsh-desktop/assets/plugins/picturereader`、`git checkout main -- docs/qq-group-qrcode.jpg`、取 main 的 LICENSE 三处、`dsh-settings-nav-custom/lib/client.js`
  - [ ] 0.4 二进制/锁定文件：`package-lock.json` 标记 ours 后续重建；`npm install --package-lock-only`
  - [ ] 0.5 `git status` 核对冲突清单与主文档 §6 逐组对应，无遗漏后 commit（merge commit）

- [ ] Task 1: 配置与文档冲突解决（§6-A/B 组）
  - [ ] 1.1 `.github/workflows/ci.yml`：refactor 版基底（Node26+cargo+native）并入 main paths 过滤（`.agents/skills/**`）
  - [ ] 1.2 `.github/workflows/release.yml`：取 main 禁用占位版（Task 10 删除）
  - [ ] 1.3 根 `.gitignore` + `dsh-desktop/.gitignore`：refactor 版 + main 条目并集
  - [ ] 1.4 `README.md`/`README.en.md`：main 版基底，下载链接占位待 Task 11 更新为 Tauri 双平台产物
  - [ ] 1.5 `dsh-desktop/package.json`：deps 全取 main（0.1.1-rc.2 全家桶）+ refactor devDeps 并入（napi/cargo 工具链）；scripts 取 refactor；version 6.0.0；`electron-builder.yml`/`tsconfig.json`/`CHANGELOG.md`/`dsh-desktop/README.md` 按解决表
  - [ ] 1.6 tsconfig include 并入 `../tauri-shell/sidecar/**`；门禁全绿 → commit

- [ ] Task 2: 插件资产冲突与旧插件清理（§6-C 组）
  - [ ] 2.1 确认 picturereader 树已取 main 3.1.0（Task 0.3 完成）；`node_modules` 210 文件无冲突残留
  - [ ] 2.2 删除 refactor 独有旧插件：`dsh-webui-market`、`zat-dsh-engine`、`dsh-file-drop`、`dsh-auto-compact`、`dsh-eac-core-bridge`、`dsh-tool-vision`、`dsh-tdai-memory`
  - [ ] 2.3 删除前核对：`grep -r "dsh-eac-core-bridge\|zat-dsh-engine\|dsh-webui-market" dsh-desktop/lib dsh-desktop/scripts dsh-desktop/test` 零引用；`builtin-plugins.json` 与 `plugin-registry-data.ts` 注册表同步清理
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

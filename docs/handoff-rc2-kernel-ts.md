# 交接文档：RC2 内核替换 + TypeScript 化目标

> ⚠️ **状态更新（2026-08-22 晚）：RC2 换核已取消，项目已完整回退到 `0.1.0-rc.7` 并验证通过**
> （根 package.json / lock 经 git 还原，tauri-app/resources/app/package.json 手动还原，
> `npm ci` 12 秒重装 779 包、patch-deps 四补丁全部自动应用、check-syntax 通过、
> **266/266 测试全绿**）。本文 §1/§3 的目标与进展快照**不再有效，勿按其执行**；
> §4 坑清单（arborist 病态慢速必须走全新 lock 安装路径、patch-deps 哈希文件名、
> SQLite 不兼容预警等）与 §5 TypeScript 化铁律**仍然有效**——TS 化（V-T 设计）依旧是
> 项目既定方向。
>
> 写于 2026-08-22。交接对象：下一个接手本仓库的开发模型/开发者。
> 本文是**唯一权威交接入口**。阅读顺序：§1 目标 → §3 进展快照 → §4 坑清单 → §5 TS 化决心。
> 关联文档：`docs/tauri-typescript-refactor-design.md`（V-T 阶段设计，已用户三轮确认）、
> `docs/tauri-migration-handoff.md`、`README.md`、`CHANGELOG.md`。

---

## 0. 一页速览（TL;DR）

| 项 | 状态 |
| --- | --- |
| 项目 | Deepseek Harness EAC v4Lite（`dsh-desktop-lite`）：把官方 `@deepseek-ai/dsh` 内核封装成 Windows 桌面客户端 |
| 本次目标 A | 内核 `0.1.0-rc.7` → **`0.1.1-rc.2`**（官方 2026-08-19 发布的 "RC2"，GitHub tag `dsh-v0.1.1-rc.2`） |
| 本次目标 B | 壳层编排代码全面 TypeScript 化，**「万物皆插件」理念零损伤**（详见 §5） |
| 已完成 | ① 官方 RC2 发布与 npm 发布情况核实（19 个内核包全部有 `0.1.1-rc.2`）；② 根 `package.json` 19 处版本替换；③ `tauri-app/resources/app/package.json` 同步替换 |
| 进行中 | ④ `npm install` 全新安装 RC2 内核（旧树/旧 lock 已删，全新解析路径，见 §4 坑 1） |
| 未开始 | ⑤ 补丁目标核对 → ⑥ 测试套件 → ⑦ Electron 真机验证 → ⑧ Tauri staging 重建 → ⑨ 浏览器 UI 实测（逐步命令清单见 §3.3） |
| 最大的坑 | npm arborist 在「变更已有巨型 lock」路径上病态慢速（23 分钟零写盘），必须走全新安装路径；`patch-deps.js` 的 pnpm 补丁目标文件名带内容哈希，RC2 下可能改名 |

---

## 1. 目标声明

### 1.1 目标 A：内核替换为 RC2（`0.1.1-rc.2`）

**背景**：DeepSeek Harness 官方仓库（https://github.com/deepseek-ai/deepseek-harness）发布节奏极快。
本项目出厂内核是 `0.1.0-rc.7`。官方此后连续发布：

| 官方发布 | 时间 | 与本项目的关系 |
| --- | --- | --- |
| `v0.1.0-rc.8` | 2026-08-20 | 中间版本（含 SQLite 存储格式不兼容变更，见 §4 坑 5） |
| `v0.1.1-rc.1` | 2026-08-19 | 中间版本（新增 V4-Flash-Vision-Exp 视觉模型、Bubblewrap 沙箱逃逸修复） |
| **`v0.1.1-rc.2`（RC2）** | **2026-08-19（交接当天 7 小时前）** | **本次目标版本**：DeepSeek 适配器优先经 Files API 上传图像并可复用已上传文件；图像预处理按模型要求自动缩放转格式 |

**已核实的依赖闭包差异（rc.7 → 0.1.1-rc.2）**——这是本次换核最重要的技术结论：

- `@deepseek-ai/dsh` 的 dependencies **包名集合完全一致，仅版本号统一升到 `^0.1.1-rc.2`**；
- 唯一新增硬依赖：**`@deepseek-ai/dsh-tool-pwsh-persistent`**（对应 rc.8 的「Windows PTY 持久 PowerShell 会话」特性），npm 会作为传递依赖自动安装，**无需**手工加进 package.json；
- `@deepseek-ai/cordis-plugin-group` 维持 `1.0.1`（其 dist-tags `latest=1.0.1`，与内核版本体系无关）；
- 本项目额外直连固定的 18 个 `@deepseek-ai/dsh-*` 运行时包（anonymous-user-id / atomic-write / bash-local / code-runtime / compaction / fs / invariants / output-retention / sandbox / scope / session-telemetry / session-title-llm / shell / spill / subagent-in-process-driver / subprocess / timeout / workflow）在 npm 上**全部存在 `0.1.1-rc.2`**，逐一同步换版即可（已做）。

**验收标准（全部满足才算完成）**：

1. `node_modules/@deepseek-ai/dsh/package.json` 的 `version === "0.1.1-rc.2"`，且 `node_modules/@deepseek-ai/dsh-tool-pwsh-persistent` 存在；
2. `package-lock.json` 中 `@deepseek-ai/*` 相关条目全部为 `0.1.1-rc.2` 闭包；
3. `node scripts/patch-deps.js` 四个补丁全部按预期「应用」或「明确跳过」（见 §4 坑 2）；
4. `node scripts/check-syntax.js` 通过；`npm test`（38 个测试文件）全绿；
5. **真机验证**：`npm start` 启动 Electron 壳 → dsh web（RC2）在 `127.0.0.1` 起服务 → 原生窗口加载 Web UI 成功；`%APPDATA%\Deepseek Harness EAC v4Lite\logs\dsh-web.log` 无 ERR_MODULE_NOT_FOUND / 加载错误；
6. 浏览器实测 Web UI 可交互（会话页渲染、设置页可达）；
7. Tauri 轨：`tauri-app/scripts/stage.ts` 重新 staging 成功（bundle-manifest.json 随之重建），`cargo check` 通过。

### 1.2 目标 B：TypeScript 化（用户明确决心，见 §5）

把**壳层自有编排代码**的绝大部分 JavaScript 替换为 TypeScript（strict 模式），同时保证
「万物皆插件」产品理念与全部功能行为零损伤。方向已定，设计已批准（`docs/tauri-typescript-refactor-design.md`）。

---

## 2. 项目是什么（架构全景）

```
┌────────────────────────────────────────────────────────────────┐
│ Electron 壳（main.js，根目录）—— 当前出货轨道                    │
│  · 无边框窗口/托盘/自绘 chrome/单实例锁                          │
│  · spawn vendor/node/node.exe --use-system-ca                   │
│      <node_modules/@deepseek-ai/dsh/lib/bin.js>                 │
│      web --profile web-desktop --host 127.0.0.1 --port <稳定端口>│
│  · 配套插件同步/保护中心/插件市场/皮肤/preset（desktop-core.js） │
├────────────────────────────────────────────────────────────────┤
│ Tauri 壳（tauri-app/，Rust + sidecar TS）—— 迁移轨道            │
│  · src/*.rs：boot/service/ipc/watchdog/integrity/paths…         │
│  · sidecar/src/*.ts → tsc → sidecar/dist（shell-host/desktop-core│
│    + lib/ 11 模块，与根目录 JS 逐一对应）                        │
│  · scripts/stage.ts：整树重建 resources/app（含 bundle-manifest）│
├────────────────────────────────────────────────────────────────┤
│ 内核（换核对象）                                                 │
│  · @deepseek-ai/dsh + 19 个直连内核包（npm 固定版本，随包分发）  │
│  · 数据主目录 ~/.dsh-v4lite（DSH_HOME，与原版 ~/.dsh 完全隔离）  │
│  · 桌面专属 profile：web-desktop（bundles: dsh-base + dsh-web-app）│
├────────────────────────────────────────────────────────────────┤
│ 产品内容 = 插件（万物皆插件载体，永不 TS 化）                     │
│  · assets/plugins/ 10 个内置插件                                 │
│  · assets/skins/ 9 款皮肤                                        │
│  · assets/agent-presets/ 预设（anchored-standard / router-*）    │
└────────────────────────────────────────────────────────────────┘
```

**内核加载机制（换核为什么只动 package.json 就够）**：

- Electron：`main.js` 用 `require.resolve('@deepseek-ai/dsh/lib/bin.js')` 定位内核；
- Tauri：`tauri-app/src/paths.rs` 同布局解析 `appRoot/node_modules/@deepseek-ai/dsh/bin.js`；
- profile 的 `node_modules` 是**指回应用 node_modules 的 junction**（dsh-app-boot 从内置 dsh 包出发
  做 BFS 维护 fallback closure）——应用侧 node_modules 换成 RC2 后，junction 自动指向新代码，
  **无需对用户 profile 做内核手术**；
- `scripts/patch-deps.js`（postinstall 自动跑）向内置 dsh 包注入 `schemastery` 依赖声明，
  保证 BFS 闭包可达（v3.0.0 事故的机制级修复，见根 README「关键决策」表）。

---

## 3. RC2 换核进展快照（截至 2026-08-22）

### 3.1 已完成 ✅

| # | 内容 | 产物/证据 |
| --- | --- | --- |
| 1 | 官方 RC2 调研：GitHub Releases 三连发确认；npm 逐一核实 **19 个内核包全部已发布 `0.1.1-rc.2`**（`npm view <pkg> versions`）；`cordis-plugin-group` latest 仍为 1.0.1 | 本文档 §1.1 |
| 2 | 依赖闭包对比：rc.7 与 0.1.1-rc.2 的 `@deepseek-ai/dsh` dependencies 逐项 diff —— 包名集合一致，仅版本升级 + 新增 `dsh-tool-pwsh-persistent` | 本文档 §1.1 |
| 3 | 根 `package.json`：19 个 `@deepseek-ai/*` 条目 `0.1.0-rc.7` → `0.1.1-rc.2`（其余 zstddec/schemastery/koffi/electron 等一律不动） | git diff 可见 |
| 4 | `tauri-app/resources/app/package.json` 同步换版（注：此文件是 stage.ts 的生成产物，本次手改仅为保持树内一致，下次 staging 会整体重建） | git diff 可见 |

### 3.2 进行中 🔄

| # | 内容 | 接班者需要知道的关键细节 |
| --- | --- | --- |
| 5 | **`npm install` 全新安装 RC2**。旧 `node_modules`（rc.7，约 647MB）与旧 `package-lock.json` 已**删除**，正在从零解析安装（registry=npmmirror）。日志重定向到 `npm-install-rc2.log` | **不要**在旧 lock 上做增量安装（见 §4 坑 1）。安装完成判据：`node_modules/.package-lock.json` 出现且 `node_modules/@deepseek-ai/dsh/package.json` version 为 `0.1.1-rc.2`。若安装中断，直接重跑 `npm install --no-audit --no-fund` |

### 3.3 未开始（接班者按序执行的验证清单）⬜

> 每一步都给出判据；任何一步失败先看 §4 坑清单。

```powershell
# ⑤ 安装收尾核对（安装完成后）
node -e "console.log(require('d:/dsh lite/node_modules/@deepseek-ai/dsh/package.json').version)"   # 期望 0.1.1-rc.2
Test-Path node_modules/@deepseek-ai/dsh-tool-pwsh-persistent                                        # 期望 True
node scripts/patch-deps.js   # postinstall 已自动跑过一次；手动复跑核对四个补丁的输出行（见 §4 坑 2/3）
node scripts/check-syntax.js # 全部入口文件 ok

# ⑥ 测试
npm test                     # node --test test/*.test.mjs，38 个文件全绿

# ⑦ Electron 真机验证（核心！）
npm start                    # 非阻塞启动；观察窗口出现 + 加载动画 → Web UI
# 判据：日志 %APPDATA%\Deepseek Harness EAC v4Lite\logs\desktop.log 与 dsh-web.log
#   · dsh-web.log 出现 "dsh web: http://127.0.0.1:<port>" 且无模块加载错误
#   · 浏览器/窗口访问该端口返回 200 且界面可交互
# 注意：dev 模式 userData 目录名可能与安装版不同（Electron 默认取 package.json name），
#       若在上述路径找不到日志，先在 main.js 里确认 dev 下 logsDir 实际落点再找。

# ⑧ Tauri 轨对齐
npm --prefix tauri-app run sidecar:check   # sidecar TS 类型检查
node tauri-app/scripts/stage.ts            # 重建 resources/app（含 RC2 闭包 + 新 bundle-manifest.json）
cd tauri-app; cargo check                  # Rust 侧编译检查（本机 cargo 1.98.0 可用）

# ⑨ 浏览器实测 Web UI（agent-browser / 手动均可）
# 打开 dsh web 端口 → 确认会话页渲染、设置页可达、无控制台报错
```

**发布物注意**：`tauri-app/target/release/resources/app/` 是上次构建的陈旧产物（内含 rc.7
package.json 拷贝），由下次 `tauri build` 自动重建，**不要手改**；Electron 侧 `npm run dist`
会经 `predist` 语法门 + `patch-deps` 后打包 NSIS。

---

## 4. 本次会话发现的关键技术事实与坑（接班必读）

1. **npm arborist 病态慢速（本次实际踩坑）**：在已有 647MB node_modules + 巨型 lock 上做
   「19 包换版」增量安装，23 分钟 CPU 持续燃烧、3.2GB 内存、**零写盘**（lock 无 rc.2 字样、
   磁盘 dsh 仍是 rc.7）。**解法已验证可行：删除 `node_modules` 与 `package-lock.json` 全新
   安装**（registry 已是 npmmirror）。接班者若遇到同样症状（进程 CPU 涨、WS 平台期、无文件
   变化），果断止损走全新安装，不要等。
2. **`patch-deps.js` 的 pnpm 黑窗补丁目标文件名带内容哈希**：当前目标是
   `node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js`（`spawnSync("pnpm",…,{shell:win32})`
   缺 `windowsHide` 的修复）。RC2 重新构建后该哈希文件名**很可能变化**。安装完成后必须检查：
   若日志输出「内置 dsh plugin forwarder 不存在，跳过」，需在新的 `lib/plugin-*.js` 里 grep
   `shell: process.platform === "win32"` 找到新文件名并更新 `patch-deps.js` 的 `target` 常量
   （其余三个补丁都是模式匹配/幂等注入，不依赖文件名，跳过逻辑安全）。
3. **`patch-deps.js` 另两个上游补丁在 RC2 的命中情况未知**：picker-native worker 退出码补丁、
   settings-general 左栏滚动 CSS 补丁均为「不匹配就告警跳过」设计，不会阻断安装；但若 RC2
   上游已自带修复/改了压缩产物形态，需人工确认补丁是否仍必要（不必要可留空转，必要则改
   正则）。
4. **文件搜索工具默认忽略 node_modules**：本次 Glob/LS 一度误判「依赖未安装」。判断安装状态
   一律以 `Test-Path node_modules/@deepseek-ai/dsh/package.json` + 读其 version 为准。
5. **rc.8 的 SQLite 存储格式不兼容（上游变更，随 RC2 一起带入）**：官方 release notes 明示
   「改善 SQLite 后端……**数据结构不兼容**」。对老用户（rc.7 时代的 `~/.dsh-v4lite` 会话数据）
   升级到 RC2 内核后**旧会话可能无法读取**。这是上游行为，桌面壳无法屏蔽；交接后如遇用户
   反馈「会话丢失/加载失败」，先对照此条。README「升级/降级不破坏数据」的表述在本次换核
   场景需要按此口径向用户说明（配置/插件不受影响，受影响的是会话存储层）。
6. **profile junction 机制使换核对用户透明**：`~/.dsh-v4lite/profiles/web-desktop/node_modules`
   是指向应用 node_modules 的 junction，应用换 RC2 后自动生效，无需迁移脚本；但**首次启动
   会触发 BFS closure 重建**，启动耗时略增属正常。
7. **构建机环境**：Node v24.11.1 / npm 11.6.2 / cargo 1.98.0（rustc 1.98.0，2026-08-18）；
   registry=npmmirror；`vendor/node/node.exe` 与 `vendor/npm/bin/npm-cli.js` 均已就位
   （stage.ts 前置条件满足）；`sidecar/dist` 当前不存在，staging 前需先
   `npm --prefix tauri-app run sidecar:build`。
8. **测试基线**：根 `npm test` = `node --test "test/*.test.mjs"`，38 个文件（README 宣称 259 项
   断言）。换核不改动任何被测模块，理论上应全绿；若有失败，先区分「换核引入」vs「历史预存
   失败」（V-T 设计文档 §七 提到过 2 个预存失败，以 git stash 前后对比法定位）。

---

## 5. TypeScript 化目标与决心（用户原话级要求，接班者必须贯彻）

**用户决心（原文要义）**：要把**超级大部分 JavaScript 替换为 TypeScript**，并且**保证功能服务、
「万物皆插件」理念不受影响**。这不是可选项，是本项目的既定方向。

**与既有设计的衔接**：完整设计见 `docs/tauri-typescript-refactor-design.md`（V-T 阶段，已经
用户三轮确认批准）。其最高原则在本交接中重申并升级为**铁律**：

1. **「万物皆插件」载体永不 TS 化**——`assets/plugins/`（10 个内置插件）、`assets/skins/`
   （9 款皮肤）、`assets/agent-presets/` 是**产品内容**，不是壳层胶水代码。它们以 JS 形态被
   dsh 内核的 cordis loader / ModuleLoader 动态加载，**永远保持 JS 原样分发**。TS 化范围
   **绝不**包含它们。
2. **功能零变化**：不新增、不删除、不修改任何用户可感知行为。窗口/托盘/插件市场/皮肤切换/
   余额/保护中心/preset 同步全部原样保留；移植逐函数对照，语义、吞错记日志风格、日志文本
   一致。
3. **TS 化的本质**：运行时仍是 JS（tsc → 等价 JS），机制上无行为差异；风险只在移植手误，
   用测试锁死（契约测试 + 模块单测 + 真机点检）。
4. **范围（✅ 转 / ❌ 不动）**：
   - ✅ 转 TS：sidecar 13 个自有模块（`sidecar/src/` 已是 TS，持续扩充）、新构建脚本
     （stage.ts 已示范）、desktop-core / shell-host / 根目录共享 .js 的 TS 副本（V-T 顺序）、
     全部新增测试；
   - ❌ 不动：assets/ 全部产品内容、dsh 上游内核、RPC 帧格式、settings 双端写兼容、
     220+ 旧 JS 测试（它们测的是冻结轨道，V-F 观察期后随旧轨删除）。
5. **顺序不变**：先拿 RC2 换核后的已验证 JS 基线（本文 §1.1 验收标准），再执行 V-T
   （叶子模块 → 行为关键模块 → desktop-core/shell-host → 全量复验 ×3）。

---

## 6. 附录

### 6.1 内核版本对照表（已核实，2026-08-22）

| 包 | 旧 | 新（RC2） | npm 状态 |
| --- | --- | --- | --- |
| @deepseek-ai/dsh | 0.1.0-rc.7 | **0.1.1-rc.2** | ✅ 已发布 |
| @deepseek-ai/dsh-anonymous-user-id | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-atomic-write | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-bash-local | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-code-runtime | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-compaction | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-fs | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-invariants | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-output-retention | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-sandbox | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-scope | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-session-telemetry | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-session-title-llm | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-shell | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-spill | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-subagent-in-process-driver | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-subprocess | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-timeout | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/dsh-workflow | 0.1.0-rc.7 | 0.1.1-rc.2 | ✅ |
| @deepseek-ai/cordis-plugin-group | 1.0.1 | 1.0.1（不动） | latest=1.0.1 |
| （新增传递依赖） | — | @deepseek-ai/dsh-tool-pwsh-persistent ^0.1.1-rc.2 | npm 自动解析 |

### 6.2 关键文件地图

| 文件 | 职责 | 换核相关性 |
| --- | --- | --- |
| `package.json` / `package-lock.json`（根） | 内核版本声明 / 锁定 | **已改 / 重建中** |
| `tauri-app/resources/app/package.json` | stage 生成产物（已手改对齐） | 下次 staging 重建 |
| `scripts/patch-deps.js` | postinstall 四补丁 | **坑 2/3：需核对哈希文件名** |
| `main.js` | Electron 入口（spawn dsh web） | 不改（版本无关） |
| `desktop-core.js` | 壳编排层（插件同步/市场/保护中心） | 不改 |
| `tauri-app/scripts/stage.ts` | Tauri 资源整树重建 + bundle-manifest | 换核后必须重跑 |
| `tauri-app/src/integrity.rs` | 启动前 bundle 完整性校验 | 消费新 manifest，不改 |
| `vendor/node|npm` | 内置运行时 | 已就位 |
| `docs/tauri-typescript-refactor-design.md` | V-T TS 化设计（已批准） | §5 铁律来源 |

### 6.3 常用命令速查

```powershell
npm install --no-audit --no-fund        # 安装/恢复依赖（npmmirror）
npm run fetch-runtime                   # 重建 vendor/node + vendor/npm（仅缺时）
npm start                               # dev 启动 Electron 壳
npm test                                # 38 个测试文件
npm run dist                            # NSIS 安装包（predist 语法门自动执行）
npm --prefix tauri-app run sidecar:build# sidecar TS → dist
node tauri-app/scripts/stage.ts         # Tauri 资源 staging（含 manifest）
cd tauri-app; cargo check / cargo test  # Rust 侧
```

---

*交接完毕。接班者从 §3.3 清单第 ⑤ 步继续；任何决策冲突时，以 §5 铁律 > §1 验收标准 > 其余为序。*

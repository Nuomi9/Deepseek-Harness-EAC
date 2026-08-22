# Tauri 迁移计划 v2（融合版）

> 本文取代 `docs/tauri-migration-handoff.md` §「待办工作」中的计划部分；交接报告的其余内容（文件清单/命令速查/技术坑）仍然有效。
> v2 = 原批准计划 + 对 `plan-rebuild.md`（外部建议稿）的评估融合。

---

## 一、对外部计划的评估结论

外部计划（`D:\qq文件\plan-rebuild.md`）质量高，但其基线**不是本仓库**：它假设严格 TypeScript 业务架构、既有 4MB 长度前缀 RPC、Rust supervisor + N-API 层、34 个 IPC、8 浮窗、向导、更新窗、Portable、自更新签名、Linux 四包、Node 24.19.0——这些在 v4Lite 里要么已被产品决策裁剪，要么从未存在。**不得按它去"复用"这些不存在的组件。**

### 采纳（7 项，融入本计划）

| # | 采纳项 | 来源章节 | 价值 |
|---|---|---|---|
| A | **远程页面能力收紧**：remote 上下文只授 `core:event:allow-listen/unlisten` + `core:window:allow-start-dragging`，撤掉 `core:default` 与全部 core:window:*；敏感命令在 Rust 侧校验「窗口标签 + 当前 URL origin === 运行期确认的 127.0.0.1:<port>」 | §5 | 直接回应"安全攻击面"动机；当前远程页能摸到全部 core:window 权限，过宽 |
| B | **结构化业务错误**：sidecar 业务错误统一 `{ code, message }` 形态（渐进改造，新方法必须遵守，旧方法遇到再改）；**不改帧格式** | §3 | 错误可分类处理；避免纯字符串匹配 |
| C | `chrome_init` 增加 `desktopShell: 'tauri'` 诊断字段（仅诊断显示，不做功能分支） | 公共接口变化 | 成本≈0，便于线上排查"到底跑的哪个壳" |
| D | **localStorage 迁移**：这是原计划唯一没覆盖的真实用户数据缺口（WebView2 存储目录 ≠ Electron 的 Chromium profile，UI 偏好会丢）。冻结的 Electron 版末版加导出（DSH origin 的 localStorage → userData/migration-localstorage.json，0600），Tauri 首启加载 Web UI 后一次性写入并删明文文件、写完成标记 | §6 | 兑现"保持现有用户数据"承诺 |
| E | **基线度量**：切换前在同一台机器记录 Electron 版与 Tauri 版的冷启动到 UI 就绪耗时、空闲内存、安装包体积、退出后残留进程数，写进 Release 说明 | §1 | 验收标准从感觉变成数字 |
| F | **发布门禁（简化版）**：Tauri 版先以 `v4Lite-tauri-preview.N` 独立 Release 资产发布（与 Electron 版并存、不互相覆盖），收集反馈 ≥14 天且无阻断级回归后才把默认下载指向 Tauri 版；Electron 末版 tag+二进制永久保留作回退 | §8 | v4Lite 无更新通道，"渠道"=GitHub Release 资产命名，成本极低 |
| G | **RPC 契约类型化**：把 shell-host 方法表沉淀为 `docs/rpc-contract.md`（方法名/参数/响应/错误码清单），契约测试逐项对照；TS 侧可在 test 里加类型定义。**保持行式 JSON 帧** | §3 | 防两侧漂移；见下方"拒绝"里不改帧的理由 |

### 拒绝（附理由，接手者不要做）

| 拒绝项 | 理由 |
|---|---|
| Linux（deb/rpm/pacman/AppImage、WebKitGTK、GLIBC≤2.34 门禁） | 用户已拍板继续 Windows-only |
| Portable 单 EXE / 自解压启动器 | v4Lite 已移除便携版（commit d84ee31） |
| 自更新器、签名 manifest/.sig、更新回退链 | v4Lite 已移除官方更新流；updater.js 仅作为 settings/overlay 工具库由 sidecar 承接 |
| 浮窗（含隔离存储上下文）、插件选择向导、更新窗、Extension Hosts、files.onDrop/getPathForFile 拖放 API | v4Lite 功能面里不存在；preload 无这些 API |
| 改用 4MB 长度前缀 RPC 帧 | 现行式 JSON 已有 7 个契约测试锁定；负载全是小 JSON，长度前缀的收益（大二进制/帧边界）不成立，重帧是纯 churn |
| "抽取壳无关 TS 核心、拆 28 个 Electron TS 文件" | 本仓库是 CJS JS；同等目标已由 desktop-core.js（DI 化迁出）完成 |
| 升级到 Node 24.19.0 | 保持 fetch-node 机制复制系统 Node 的现状（ABI 一致性设计），版本随系统走 |

---

## 二、修订后的剩余执行计划

已完成部分（P0–P4 + 交接报告 §3）不再重复。以下为**从当前状态出发**的阶段，含验收标准。

### V-A 安全收紧（约 0.5 周）〔采纳项 A/C〕
1. `capabilities/main.json`：local 上下文保留现有权限；新增/改分 remote 上下文能力 = `core:event:allow-listen`、`core:event:allow-unlisten`、`core:window:allow-start-dragging` 三项，删除 `core:default` 与其余 core:window:*。
2. `ipc.rs` 敏感命令（guard_action/plugin_*/balance_prices_set|reset/chrome_menu 写操作）增加第二重校验：`window.url()` 的 origin 必须等于 `state.web_url` 或本地页 origin。
3. `chrome_init` 返回值加 `"desktopShell": "tauri"`；chrome.ts 徽标 title 顺带展示（可选）。
4. 验收：远程页 `__TAURI__.window.minimize()` 之类核心调用被拒；自有命令正常；recovery 页功能不受影响。

### V-B sidecar 偶发失败修复（约 0.5 周）
按交接报告 §5.3：接线 `withLogs` 诊断 → `npm test` 复现 → 依日志修根因（候选：并发复制撞 Windows 文件锁/AV、瞬时 EPERM）。修复后全量套件连续 3 次绿。

### V-C 真机验证 + 基线度量（约 1 周）〔采纳项 E〕
1. debug 构建，`DSH_DESKTOP_USERDATA`/`DSH_HOME` 重定位启动。
2. CDP 点检清单（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`，Node24 全局 WebSocket 直连）：窗口出现、标题栏图标/徽标、菜单开合、最小化/最大化、托盘显隐、Web UI 加载、发送一条对话、皮肤切换生效、插件市场/管理/保护中心页打开、重启 Web 服务、退出后 `tasklist` 无 node.exe/conhost.exe 残留。
3. 用真实 `~/.dsh-v4lite`（关掉 Electron 版防互踩）复跑一遍关键路径。
4. 度量并记录：两版冷启动→UI 就绪 ms、空闲工作集 MB、安装包/目录体积、退出残留进程数 → 写入 `docs/tauri-migration-baseline.md`。

### V-D 打包（约 1 周）
1. 写 `tauri-app/scripts/stage.mjs`：产出 `resources/{app,node,npm}`——app = package.json + 生产依赖闭包 node_modules（`npm ls --omit=dev --all --parseable` 求闭包拷贝）+ 根 JS（shell-host/desktop-core/updater/plugin-*/balance/preset-sync/builtin-collision/patch-row-heal/profile-module-heal/plugin-manager-state/error-detail/koffi-preflight 相关）+ scripts/{koffi-preflight.cjs,plugin-manager-patch.js} + assets/** + bundle-manifest.json（按 integrity::build_bundle_manifest 同口径生成）。
2. NSIS installer-hooks 完整移植 `build/installer.nsh`：三代 exe taskkill、MAX_PATH 嵌套目录治愈、自定义运行中检测；把 `installer-nsh-*` 三个测试改造成对新 hooks 的断言。
3. SHA256SUMS 与 verify-dist-fresh 适配新产物布局。
4. 验收：全新机安装 → 走 V-C 点检；覆盖安装 → 数据保留、无嵌套目录。

### V-E localStorage 迁移（0.5~1 周，推荐做）〔采纳项 D〕
1. Electron 冻结末版：退出前（或菜单手动触发）把 `http://127.0.0.1:<webPort>` origin 的 localStorage 导出为 `%APPDATA%/<app>/migration-localstorage.json`。
2. Tauri 版 boot：检测该文件且无完成标记 → 加载 Web UI 后 eval 写入 → 校验抽样键 → 写 `migration-done` 标记 → 删明文文件。
3. 验收：Electron 版改过的会话分组/侧栏偏好在 Tauri 版首启后仍在。

### V-F preview 发布与观察（14 天墙钟，可与 V-G 并行）〔采纳项 F〕
GitHub Release 发 `Deepseek-Harness-EAC-Tauri-Setup-preview.N.exe`（附 SHA256SUMS 与已知差异表：displayBalloon→Toast、.lnk 未嵌 AUMID、devtools 已内置）。观察期门禁：无阻断级/高严重度回归。

### V-G 切换默认 + 收尾（0.5 周）
README 重写（Tauri 架构图、行为差异表、回退路径=旧 Release）、Release 默认资产切换、打 tag 保留 Electron 末版。归档删除 Electron 代码**另起一个版本**做（预览期通过后再删）。

工期合计：工程量约 3.5~4.5 周 + 14 天观察期墙钟。

---

## 三、接口变化登记（对外部计划§公共接口的取舍）

- `window.dshDesktop` 字段/方法名/返回语义保持兼容（不变）。
- 新增 `ChromeInfo.desktopShell: 'tauri'`（采纳 C）。
- 不引入 `DesktopHostRequest/Response/Event` 强类型协议层与 `files.onDrop`（拒绝理由见上）；契约以 `docs/rpc-contract.md` + 契约测试承载。

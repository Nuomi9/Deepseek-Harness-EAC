# DSH Desktop Tauri 迁移 + TypeScript 化 —— 完整交接文档

> 给下一位模型维护者的执行交接。本文件是「当前唯一真相源」：先读它，再读它引用的文档。
> 交接时间：2026-08-22。上一执行者已验证状态均以本文件「复核证据」为准，勿凭对话记忆。

---

## 0. 一句话现状

Electron 桌面壳已基本迁到 **Tauri 2 + Rust + TS sidecar**，安装包可打包并真机验收；
sidecar 轨道 **13 个模块全部 TypeScript 化**、strict 零错误、266/266 测试绿；
**V-T 接线切换已完成并通过安装版真机全量验收**（含看门狗残留 bug 修复）。
剩余：V-E（localStorage 迁移，待用户决策）→ V-F/V-G（发布观察期）。

---

## 1. 必读文档（按顺序）

| 文件 | 作用 |
|---|---|
| `docs/tauri-migration-plan-v2.md` | **原始执行计划**（V-A~V-G 七阶段），含对外部建议稿的采纳/拒绝清单 |
| `docs/tauri-migration-handoff.md` | 原始交接：文件级清单、构建命令速查、**12 条技术坑** |
| `docs/tauri-typescript-refactor-design.md` | **TS 化设计**（三轮确认后获批）：模块拆分/依赖图/接线方案 |
| `docs/tauri-execution-plan.md` | **TS 化实施计划**（分阶段） |
| `docs/tauri-migration-baseline.md` | 真机验证基线（启动耗时、内存、V-C/V-D 发现修复的 7 个 bug） |
| **本文件** | 当前状态 + 待办 + 红线汇总 |

---

## 2. 架构与目录

```
dsh lite/
├── main.js / desktop-core.js / updater.js / …   ← 冻结的 electron 版（双轨并存，勿动）
├── assets/                                      ← 冻结红线（插件/皮肤/preset 载体）
├── sidecar/                                     ← 【V-T 重心】TypeScript 源码
│   ├── src/
│   │   ├── shell-host.ts        sidecar 入口（stdio 行式 JSON-RPC）
│   │   ├── desktop-core.ts      业务编排层（1191 行 JS 移植）
│   │   ├── lib/                 11 个移植模块（见 §5）
│   │   └── vendor.d.ts          js-yaml/koffi 最小类型声明
│   ├── test/lib.test.ts         叶子模块 TS 单测（node --test 原生跑编译产物）
│   └── dist/                    tsc 编译产物（运行时入口）
└── tauri-app/                   Tauri 壳（Rust）
    ├── src/                     lib.rs/boot.rs/sidecar.rs/paths.rs/ipc.rs/…
    ├── scripts/stage.ts         V-D 打包 staging（TS 编写）
    ├── nsis/installer-hooks.nsh 安装/卸载钩子
    └── target/release/bundle/   NSIS 安装包输出
```

**运行时链路**：Tauri 壳 spawn `node <appRoot>/sidecar/dist/shell-host.js --app-root …`，
sidecar 通过 stdio 行式 JSON-RPC 驱动 desktop-core（含插件同步/保护中心/余额/更新/市场队列）。

---

## 3. 红线（任何改动必守）

1. **冻结 `assets/`** —— 不增删改。
2. **冻结 Electron 旧代码**（根目录 `.js`）—— 双轨并存期只读不写。唯一例外待定（见 §8 V-E）。
3. **改 `frontend/chrome.ts` 必须重跑 `npm run build:inject`。**
4. **验证一律用 debug 构建 + `DSH_DESKTOP_USERDATA` 重定位数据目录**，绝不污染真实用户数据。
5. **任何阶段完成都必须真实运行验证**，不许只凭编译通过宣称完成（红线 §5 已用 7 个真机 bug 证明其价值）。
6. **改 sidecar 任何 `.ts` 后**：重跑 `npm run sidecar:build`（dist 是运行时）。

---

## 4. 构建命令速查

```powershell
# sidecar TS 编译（类型检查 + 产物）
cd tauri-app
npm run sidecar:check     # tsc --noEmit（strict + noUncheckedIndexedAccess）
npm run sidecar:build     # 产出 ../sidecar/dist

# 全量 JS/TS 单测
npm test                  # 含 sidecar-rpc 契约测试（已指向 dist 产物）+ lib.test.ts

# Rust 单测
cargo test                # (在 tauri-app/)

# dev 调试构建
npm run dev               # = build:inject && tauri dev

# release 打包
npm run build             # = build:inject && node scripts/stage.ts && tauri build

# 发布哈希
node scripts/make-release-hashes.js   # 自动识别 NSIS 产物目录
```

**验证工具**：`node scripts/vc-check.mjs --cdp <port>`（真机 CDP 点检 11 项）、
`scripts/stage.ts`（打包 staging 完整性自检：bundle-manifest 同口径）。

---

## 5. V-T TypeScript 化 —— 已完成（13/13）

全部**逐行忠实移植**自根目录同名 `.js`，头注释标注 `// 忠实移植自 …`，错误字符串/日志逐字节保留。

| sidecar/src | 移植自 | 说明 |
|---|---|---|
| `shell-host.ts` (src/) | shell-host.js | sidecar 入口，只做 argv/RPC 分发 |
| `desktop-core.ts` (src/) | desktop-core.js | 业务编排（插件同步/保护/余额/更新/市场） |
| `lib/balance.ts` | balance.js | 账户余额/峰谷计价 |
| `lib/plugin-guard.ts` | plugin-guard.js | 保护中心（快照/回滚/体检/守护启动） |
| `lib/plugin-updater.ts` | plugin-updater.js | 内置插件上游更新 |
| `lib/updater.ts` | updater.js | dsh agent 自我更新 |
| `lib/preset-sync.ts` | preset-sync.js | 内置 agent preset 同步 |
| `lib/builtin-collision.ts` | builtin-collision.js | 内置 vs 市场同名包迁移 |
| `lib/patch-row-heal.ts` | patch-row-heal.js | patch 行去重/整理 |
| `lib/profile-module-heal.ts` | profile-module-heal.js | profile node_modules 遮蔽清理 |
| `lib/plugin-manager-state.ts` | plugin-manager-state.js | 插件管理状态合并 |
| `lib/plugin-manager-patch.ts` | scripts/plugin-manager-patch.js | patch 增删（toggle/remove/hasEntry） |
| `lib/koffi-preflight.ts` | koffi-preflight.js | koffi FFI 预检 + overlay 降级 |

**复核证据**：`npm run sidecar:check` 0 error；`npm test` **266/266 全绿**（sidecar-rpc 契约测试
已改指 `sidecar/dist/shell-host.js`，lib.test.ts 指向 dist）；`cargo test` **12 passed**。

### 接线已改（V-T-7 代码完成）
- `tauri-app/src/sidecar.rs`：host 路径 → `<appRoot>/sidecar/dist/shell-host.js`
- `tauri-app/src/boot.rs`：孤儿清扫匹配同样路径
- `tauri-app/scripts/stage.ts`：拷贝 `sidecar/dist` 整树到 `resources/app/sidecar/dist/`
- `test/sidecar-rpc.test.mjs`：契约测试指向 dist 产物

### ✅ V-T 收尾已完成（2026-08-22 真机验收）
- `npm run build` 链已接入 `sidecar:build`（dev/build 均先编译 TS）
- 重打包 + 覆盖安装 + 全新重定位目录真首启：preset×3 → 19 插件/皮肤 → koffi 通过 → Job 分配 → Web UI 就绪
- CDP 点检 11/11 绿；优雅退出 5671ms；**看门狗随主壳干净退出（零残留）**

### V-T 收尾期发现并修复的第 8 个真机 bug
**看门狗幽灵残留**：主壳优雅退出后看门狗空转不退。根因：`watchdog_loop` 先 `alive(pid)`
短路再读 state，Windows 下进程对象滞留使 alive 对已死 pid 误报存活，永远读不到
`cleanExit:true`。修复：cleanExit 检查提升到循环最前（不依赖 alive 探测）。
验证：`watchdog.log` 出现 "clean exit marker found, exiting"。

### ⚠️ 环境坑（下任必读）
1. **C 盘空间是打包/安装的隐形杀手**：`makensis` mmap 失败、NSIS `/S` 安装 exit=2 且静默回退旧文件、
   手工组装目录启动弹 "Error launching CrashSender.exe"——全是 C 盘满导致。
   **对策**：构建与安装时设 `$env:TMP=$env:TEMP='D:\...'`；重定位测试数据一律放 D 盘。
2. exe 的 `LastWriteTime` 在 NSIS 解压后不可靠（保留打包元数据），验证版本用行为探针而非时间戳。
3. 手工拼装 `<exe>+resources` 目录不能代替完整安装（缺配套组件会崩），验收必须走真实安装器。

---

## 6. 之前阶段状态（已完成，复核证据已核实）

| 阶段 | 状态 | 关键证据 |
|---|---|---|
| V-B | ✅ | withLogs 接线，全量并发连续多轮 266 绿 |
| V-A | ✅ | capabilities 收紧到 3 项 + 9 个敏感命令 origin 二重校验 + desktopShell:'tauri' |
| V-C | ✅ | 真机验证，修复 4 个编译期不可见 bug（Job 权限/主窗不显示/本地页白名单/Tauri 2.11 ACL） |
| V-D | ✅ | 安装包 75.3MB 铺垫；真机又修复 3 bug（路径缺 resources 层/verbatim 毒 Node/退出被看门狗误重启）；退出统一 `shutdown_flow`；SHA256SUMS + 覆盖安装数据保留 |

真机验证累计修复 **7 个编译期不可见 bug**，详见 `docs/tauri-migration-baseline.md`。

---

## 7. 关键 Rust 结构速览（改 Rust 前必读）

- **[lib.rs](file:///d:\dsh lite\tauri-app\src\lib.rs)**：`shutdown_flow`（统一优雅退出：写干净退出标记防看门狗误判 → 回收进程树 → exit(0)）；`RunEvent::ExitRequested` 阻止 + 转流。
- **[paths.rs](file:///d:\dsh lite\tauri-app\src\paths.rs)**：打包布局 `<exe>\resources\app|node|npm`；**`strip_verbatim` 剥 `\\?\` 前缀**（Node 解析会炸）。
- **[sidecar.rs](file:///d:\dsh lite\tauri-app\src\sidecar.rs)**：sidecar spawn/kill（关 stdin 自然退出）。
- **[build.rs](file:///d:\dsh lite\tauri-app\build.rs)**：`AppManifest` 声明 22 个命令自动生成权限 + capabilities 显式授予。**⚠️ 以后新增命令要同步改 build.rs 和 capabilities 两处。**
- **新增命令的教训**：Tauri 2.11 远程页 ACL 收紧，Web UI 调自有命令会 403 除非在 build.rs/capabilities 声明（V-C 已修，勿回退）。

---

## 8. 未完成任务与决策点

### ✅ V-E localStorage 迁移已完成（2026-08-22，方案 A 获批并落地）
实现三件套：
1. **Electron 侧导出钩子**（main.js before-quit 清理链最前，纯增量、全静默）：
   `executeJavaScript('JSON.stringify(localStorage)')` → 原子写
   `<Electron userData>/dsh-localstorage-export.json`（≤5MB 限制）。
2. **Tauri 侧迁移**（`src/ve_migrate.rs`，单测覆盖）：首启按序查找
   `%APPDATA%\Deepseek Harness EAC` 与自身 userdata 的导出文件 → 生成
   initialization_script 内嵌 JSON 写回 localStorage → 写
   `localstorage-migrated.stamp` 幂等。坏文件不写 stamp（下次重试）。
3. **stable-port** 已存在（port.rs，此前误以为缺失——测试时端口变化只是
   因为每次用全新重定位目录）。

真机验收：Electron 导出（CDP 设键→菜单退出→文件落盘）→ Tauri 首启日志
"检测到 Electron 版 localStorage 导出"→ CDP 实测键值跨壳到位 → stamp 幂等 ✓。

### ⚠️ 遗留：插件市场安装失败（反馈者环境问题，非回归）
反馈者（邓伟伦机器）市场装 GitHub 源插件报 `pnpm failed in profile directory`，
错误正文被 GBK/UTF-8 编码错读吞成乱码。本机同命令复现**成功**
（pnpm v11.9.0 正常拉包装好）→ Tauri 版链路无回归，属反馈者环境问题
（高频嫌疑：网络到 npm/GitHub 源不通、C 盘空间、git 缺失）。
待反馈者提供 `%APPDATA%\com.deepseek.dsh.desktop.lite\logs\desktop.log`
尾部确认。注意：市场插件/dsh CLI 在冻结资产内，编码显示问题不可改码修复。

### ✅ 第 9 个真机 bug：市场安装弹 cmd 黑窗（已修复并验证）
**现象**：反馈者装插件时弹出两个"管理员: C:\Windows\System32"cmd 黑窗，
关掉又出（关窗=杀死正在运行的 pnpm → 同时导致 "pnpm failed" 安装失败——
与上一条市场问题可能是同一诱因）。
**根因**：内置 dsh CLI 的 plugin forwarder
（`node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js:108`）
`spawnSync("pnpm", …, {shell: win32})` 未带 `windowsHide` —— 无控制台的
桌面壳进程树每次调 pnpm 都经 cmd.exe 中介新建可见控制台；add 内部两次
pnpm 调用 = 两个黑窗。管理员前缀 = 反馈者提权运行应用。
**修复**：[scripts/patch-deps.js](/d:/dsh%20lite/scripts/patch-deps.js) 新增
第四个幂等补丁（windowsHide: true），postinstall 自动应用；
顺手补了 Rust 侧两处漏网闪窗（boot.rs 孤儿清扫、ipc.rs open_url_external
的 powershell 加 CREATE_NO_WINDOW）。
**验证**：真机从 GUI 链路触发真实安装，安装期间所有 cmd 进程
MainWindowHandle=0（零可见窗口），插件正常装上；方法学注意：
判定弹窗要测 MainWindowHandle≠0，进程存在≠可见窗口。

### ✅ 第 10 个真机 bug：启动莫名打开浏览器标签（已修复并验证）
**现象**：用户启动应用时系统浏览器突然打开 `tauri.localhost/loading.html`
（浏览器解析不了该域 → 错误页，"莫名其妙的网页"）。
**根因**：on_navigation 白名单在 web_url 未就绪时只放行 `127.0.0.1/localhost`，
而 Tauri v2 Windows 内部页 origin 是 `http(s)://tauri.localhost` —— 内部页
首导航被判异域 → 拦截 + open_url_external 转系统浏览器。
**修复**：白名单补 `tauri.localhost`（保留域，安全）；open_url_external
入口再过滤内部地址（防御纵深）。
**验证**：真机启动全程浏览器进程零 tauri.localhost 泄漏；外链拦截语义
保留（example.com 仍被拦转系统浏览器，powershell Start-Process 实锤）。

### ✅ 第 11 个真机 bug：点右上角 X 必崩（0xc0000005）+「Error launching CrashSender.exe」弹框（已修复并验证）
**现象**：点自绘标题栏 X（exitAction=ask 默认档）进程立刻崩溃；Windows
事件日志三次崩溃全部 `0xc0000005 / ntdll.dll / 偏移 0x9f5bd`（跨版本同
偏移=确定性路径）；随后弹「dsh-desktop-lite has stopped working / Error
launching CrashSender.exe」；desktop.log 停在「启动链路完成」零退出日志。
**取证→根因**（三层洋葱）：
1. 本机 WM_CLOSE 复现同偏移 AV，close_flow 分步日志锁死死亡点：
   `dialog::show` 内部（后台线程裸调 TaskDialogIndirect）。
2. 进程模块盘点揪出弹框真主：**微信输入法 WeType 经 TSF 注入
   `wetype_tip_core.dll` + `CrashRpt1500.dll` 到所有 GUI 进程**；
   「Error launching CrashSender.exe」是 CrashRpt 上报器启动失败的
   自带 UI（CrashSender.exe 是它的组件，与我们无关）。TaskDialogIndirect
   （comctl32 v6 + activation context 切换）与其注入 hook 冲突 → AV。
3. 修复途中两个假象排除：①COM 未初始化只是次要因素（自举后仍崩）；
   ②「MessageBoxW 也冻住」是误判——模态框等待输入本来就无返回日志，
   真正证据是用户真机截图确认降级框正常显示。另发现基于模块快照的
   「注入检测」不可靠（注入时机晚于检测点），放弃条件降级思路。
**修复**（三处）：
- [dialog.rs](/d:/dsh%20lite/tauri-app/src/dialog.rs)：**全平台弃用
  TaskDialogIndirect，统一 MessageBoxW**——双按钮场景「是/否」+正文标注
  语义（「是」=退出程序、「否」=最小化到后台）；多按钮告知型降级单 OK
  （关于弹窗的复制按钮暂失，URL 已在正文）；「记住我的选择」勾选框暂缺
  （后续可自绘窗口补回）。Cargo features 移除
  Win32_UI_Controls/Win32_System_Com/Win32_System_Diagnostics_ToolHelp。
- **所有原生弹窗改主线程派发**（`run_on_main_thread`）：close_flow 确认框、
  boot.rs `show_dialog_on_main`、ipc.rs 关于弹窗。模态框自带消息泵不阻塞
  事件循环。
- 退出路径统一：close_flow quit 档、托盘「退出」菜单原先直接 `app.exit(0)`
  → 统一走 `shutdown_flow`（否则漏写 cleanExit 标记 → 看门狗误判崩溃并
  复活进程 + sidecar 泄漏）。
**验证**：debug 真机三档回归全绿——ask：弹框→「是」→ 1708ms 有界回收 →
`cleanExit:true` 零残留；「否」→ 隐藏托盘+通知+存活；quit：直接干净退出；
全程零 WER 新增、零 CrashSender 框、零 node 孤儿。cargo test 14/14。
**教训**：①「弹框标题=进程名+has stopped working」不一定是 WER，先查
进程内注入 DLL（TSF 输入法是头号嫌疑）；②模态 API「不返回」≠挂死；
③同 exe 多实例测试时务必确认目标二进制真的是新链接产物（文件锁会让
cargo 静默用旧 exe，用日志新串做版本探针）。

### ⚠️ 环境警报：C 盘空间（复发）
排查 bug #11 期间 C 盘再次满到 0 GB（清 %TEMP% 后回到 1.33 GB）。曾导致
makensis 失败、NSIS 静默回退旧包、PowerShell Add-Type 写不了临时 DLL。
**打包/测试前必查 `Get-PSDrive C`**；本会话临时策略：`$env:TEMP` 指 D 盘。
根治需要用户做磁盘清理/迁移。

### V-F / V-G：预览发布（14 天观察）与收尾
在上述遗留清零后进入。参考 `docs/tauri-migration-plan-v2.md`。
**当前终版安装包**：SHA256 `7a39f99e1c28cd2715b13fccb3bdc1d927e9357d4e6ea70b6a0c75d4b754fbb5`
（13:26 构建，含全部 11 个真机修复；75.3 MB；SHA256SUMS 已同步 dist/ 与
bundle/nsis/ 两处）。

---

## 9. 给维护者的操作入口

拿到本文件后，建议按此推进：
1. `cd tauri-app && npm run sidecar:build`（确认 dist 最新）
2. `npm test`（确认 266 绿）+ `cargo test`（确认 12 pass）
3. **做 V-T 收尾**：`npm run build` → 覆盖装到 `D:\dsh-v4lite-vd` → 重定位跑点检 → 零残留确认
4. 回 V-E 决策点向用户确认后再动手
5. 全部绿后再进 V-F/V-G 发布

> 遇到 resolve 冲突优先看 `docs/tauri-execution-plan.md`；确需增强 sidecar 类型，
> 补充 `sidecar/src/vendor.d.ts`（js-yaml/koffi 的最小面已就位）。
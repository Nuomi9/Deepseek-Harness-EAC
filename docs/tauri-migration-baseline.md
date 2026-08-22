# Tauri 版基线度量（V-C）

> 度量时间：2026-08-22 凌晨。机器：Windows（本机），debug 构建。
> 对照组（Electron 4.4.0 同机数据）待补：需在关掉 Tauri 版、重定位目录的前提下运行 `npm start` 采集。

## 冷启动耗时（托盘就绪 → Web UI 就绪，desktop.log 时间戳）

10 轮实测（warm profile，含 sidecar 拉起、profile 同步、dsh web 启动、HTTP 探测竞争）：

| 轮次 | 耗时 ms |
|---|---|
| 1 | 4,529 |
| 2 | 5,474 |
| 3 | 6,404 |
| 4 | 5,443 |
| 5 | 8,337 |
| 6 | 6,747 |
| 7 | 5,474 |
| 8 | 8,963 |
| 9 | 7,433 |
| 10 | 6,864 |

**均值 ≈ 6,567 ms（范围 4.5s~9.0s）**。注：debug 构建偏慢；release 预计更优。
Electron 版同口径数据：_待补_。

## 空闲内存工作集（UI 就绪后静置 30s）

| 组件 | 工作集 |
|---|---|
| 壳 dsh-desktop-lite.exe | 39.6 MB |
| WebView2 进程树 ×6 | 461.0 MB |
| node ×2（sidecar + dsh web） | 158.3 MB |
| **合计** | **≈658.9 MB** |

注：debug 构建且开发机负载高；Electron 版对照：_待补_。

## 退出残留进程

| 场景 | 结果 |
|---|---|
| 菜单「退出」优雅退出（CDP 触发 chrome_menu quit） | ✅ 壳/node/端口全清（多轮验证） |
| taskkill /F 强杀壳（模拟崩溃） | ✅ 修复后 Job 兜底生效，4s 内整树回收、端口释放 |

## 安装包体积

| 产物 | 体积 |
|---|---|
| Deepseek Harness EAC v4Lite_4.4.0_x64-setup.exe | **75.3 MB**（344MB 资源 NSIS/LZMA 压缩后） |
| SHA256SUMS.txt | 已生成（tauri-app/target/release/bundle/nsis/） |

Electron 版安装包对照：_待补_。

## V-D 打包验收记录（2026-08-22）

- stage.ts 实跑：533 个闭包容器 → bundle-manifest 519 包自检通过；app=246.9MB node=85.7MB npm=11.5MB
- 静默安装 /S /D=D:\dsh-v4lite-vd exit=0；覆盖安装 exit=0 且重定位数据保留
- 打包版真机点检 11/11 全绿（CDP，端口 9224）；启动链路完整：
  sidecar ready → profile 初始化 → preset×3 → 19 配套插件/皮肤同步 → koffi 预检通过
  → dsh web 启动 → Job 分配成功 → Web UI 就绪 → 启动链路完成

### V-D 真机验证发现并修复的缺陷

1. **打包版路径解析全错（致命）**：Tauri 资源落在 `<exe目录>\resources\` 而 paths.rs
   按 `resource_dir()/app` 拼 → sidecar/托盘/内置 agent 全找不到。修复：统一加 resources 层。
2. **verbatim 路径毒杀 Node 子进程（致命）**：resource_dir() 返回 `\\?\D:\...`，
   Node 解析 verbatim 主入口失败（EISDIR lstat 'D:'）→ sidecar 秒退、dsh web 退出码 1。
   修复：strip_verbatim 剥前缀。
3. **菜单退出被看门狗误判为崩溃（安装版）**：裸 app.exit(0) 绕过 mark_clean_exit →
   看门狗 15s 后自动重启应用。修复：提取 shutdown_flow 统一流程，菜单退出共用。
4. 安装注意：C 盘空间不足会让 NSIS 解压中途失败（exit=2 且无卸载器残留）——
   发布说明应提示预留 ≥1GB 磁盘空间。

## 真机验证发现并修复的缺陷清单（V-C 的核心产出）

1. **Job Object 从未生效**（严重）：`procwin::assign_job` 的 OpenProcess 缺
   `PROCESS_SET_QUOTA` 权限位 → AssignProcessToJobObject 恒 ACCESS_DENIED →
   KILL_ON_JOB_CLOSE 形同虚设，强杀壳后 dsh web 树残留并占端口。
   修复：补权限位 + 失败原因记日志（assign_job 返回 Result）。已真机验证强杀零残留。
2. **主窗永不显示**（严重）：`start_and_show` 移植缺失「show 半边」——只设 web_url
   不导航不显示，窗口停留在隐藏的 about:blank。修复：就绪后调 navigate_main_to_web。
3. **本地页被自家导航锁拦截**：on_navigation 白名单缺 `tauri.localhost`
   （WebviewUrl::App 在 Windows 的宿主），loading.html 初始导航被拒。
4. **Tauri 2.11 远程页 ACL 收紧**（破坏性变更）：非本地 URL 调用自有命令默认拒绝
   （"not allowed. Plugin not found"）。修复：build.rs 用
   `AppManifest::new().commands(&[22 个命令])` 自动生成 allow-* 权限（下划线规范化为
   连字符）+ capabilities/main.json 显式授予；新增命令时两处必须同步维护。
5. 孤儿清扫兜底：boot 早期按「命令行属本应用运行时 且 父进程已死」回收上一实例残留
   （sweep_orphaned_runtime），作为 Job 之外的第二道防线。

## 点检清单状态

自动化通过（scripts/vc-check.mjs，11/11）：注入桥、标题栏 DOM、图标、徽标、
desktopShell=tauri、V-A minimize/close 拒绝、Web UI 根节点、对话输入框可达。
人工项待确认：⋯菜单开合、最小化/最大化按钮、托盘左键显隐、皮肤切换、插件市场页、重启 Web 服务。

# Checklist · VNext × Tauri 统一合并终验

> 用法：Task 13 终验时逐条勾选；每条须附**新鲜命令输出或实测证据**（日期+命令+结果），不接受「应该通过」。
> 对应 spec.md AC-1~AC-16。

## 一、合并正确性

- [ ] AC-1 冲突零残留
  - 证据：`git grep -l "<<<<<<< " -- . ` 零输出；冲突清单 72 处与主文档 §6 解决表逐组核对表
- [ ] AC-2 11 项修复移植可追溯
  - 证据：`git log --oneline --grep="移植"` 列出移植 commit；每项对应测试名清单：
    - [ ] 并发 dsh web 检测（#22）测试：`test/server-concurrent-guard.test.ts`
    - [ ] 安全模式守卫测试（companion patch 停摆断言）
    - [ ] schemastery 首启依赖测试
    - [ ] profile 完整性测试
    - [ ] 可选升级字段 ×3 测试（plugin-updater / patch-deps / 打包链重放）
    - [ ] 更新停滞超时 300s 断言
    - [ ] 流写入保护核对记录（已含/补齐结论）
    - [ ] escalation 豁免测试
    - [ ] 托盘完全重启（Task 8 壳层实测截图/录屏）
    - [ ] splash 主题跟随（暗/亮双主题截图）

## 二、架构终态

- [ ] AC-3 electron 零依赖
  - 证据：`grep -r "from 'electron'" dsh-desktop/lib/ dsh-desktop/shared/` 零输出 + `npm run typecheck` 零错误
- [ ] AC-4 lib/desktop 删除 + sidecar 全挂载
  - 证据：`Test-Path dsh-desktop/lib/desktop` False；sidecar server.ts 模块挂载数与 IPC 域注册数统计输出
- [ ] AC-5 snapshot 11 域可达
  - 证据：集成测试输出（overview/create/detail/restore/branch-create/branch-delete/branch-set-current/config-save/delete/gc 全调用成功）
- [ ] AC-6 插件隔离实测
  - 证据：`tasklist`/`ps` 输出显示 Host 进程独立 PID；强杀命令+核心存活验证输出；状态机 retrying/quarantined 日志摘录

## 三、双平台编译与使用

- [ ] AC-7 Windows 产物
  - 证据：NSIS Setup.exe + 便携 zip 路径、体积、SHA-256 清单
- [ ] AC-8 Linux 产物
  - 证据：`.deb` + `.AppImage`（+`.rpm`）路径、体积、SHA-256；Ubuntu 容器内 AppImage 启动日志（dsh web UI 加载成功）
- [ ] AC-9 CI 双平台
  - 证据：单次 push 的 Actions run 截图/链接，windows-latest + ubuntu-latest 两 job 全绿
- [ ] AC-10 Linux 进程围栏
  - 证据：围栏验证脚本输出——杀 sidecar 父进程后 ≤5s 全子进程退出（PDEATHSIG + 进程组）
- [ ] AC-11 Windows 专属面 Linux 静默跳过
  - 证据：平台分支单测输出（junction-patrol/.lnk/注册表/NSIS/client-update 禁用提示）+ Linux 运行日志无相关报错

## 四、TS 化与测试

- [ ] AC-12 类型与测试全绿
  - 证据：`npm run typecheck` 零错输出；`npm test` 全绿输出（附测试总数 vs 基线 499 差异说明——数量变化逐条列出理由，不得删测试降绿）
- [ ] AC-13 Rust 测试全绿
  - 证据：`npm run test:native` 输出（supervisor + snapshot + 新增 Linux 围栏用例）

## 五、退役与发布

- [ ] AC-14 Electron 彻底退役
  - 证据：`Test-Path` main.ts/preload.ts/preload//electron-builder.yml 全 False；`grep -i electron package.json` 零输出
- [ ] AC-15 Windows 升级链
  - 证据：4.4.1→6.0.0 与 5.1.0→6.0.0 两份升级脚本端到端运行输出；`.dsh` 目录前后 diff（插件与配置零丢失断言）
- [ ] AC-16 正式发布
  - 证据：v6.0.0 tag；release-tauri.yml 首轮在线 run 链接与产物清单（两平台齐全）；README 下载链接更新 commit

## 六、性能与安全专项（Task 12 入档）

- [ ] boot 关键路径 ≤500ms 回归测试输出
- [ ] sidecar 启动时间 vs Electron 版对比记录
- [ ] Windows 安装包体积 <80MB（vs Electron 155MB）
- [ ] 快照创建时间/磁盘占用基准数据
- [ ] bridge 越权调用拒绝测试输出
- [ ] 恶意 URL 导航拦截测试输出
- [ ] H2/H3 路径逃逸拒绝测试输出（Startup\*.bat 拒绝断言）
- [ ] 退出零孤儿进程验证输出（双平台）
- [ ] release 产物 devtools 禁用核验

## 七、Open questions 决议记录

- [ ] OQ-1 rpm 产出与否：决议 + 理由
- [ ] OQ-2 AppImage 命名规范对齐：决议 + README 链接

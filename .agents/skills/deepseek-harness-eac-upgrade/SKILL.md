---
name: deepseek-harness-eac-upgrade
description: Deepseek Harness EAC 升级改动全流程：先同步最新源码 → 按用户要求改动 → 自行编译验证 → 新建分支提 PR（绝不直接动 main）。当用户说「改一下 dsheac / 按我的要求改动源码 / 拉最新源码后升级」或要求走升级流程时使用；内置本机 GH_TOKEN 位置与注入方式、Rust 工具链环境事实。
---

# Deepseek Harness EAC 升级流程

## 目标

每次改动 dsheac（`zouyuxuan122/Deepseek-Harness-EAC`）源码都走同一套
流程：**先拉最新 → 按需求改动 → 自行编译验证 → PR 上去，绝不直接动
main**，并在此记录本机凭据与环境的已知事实，避免重复踩坑。

## 本机事实（2026-08 实测）

- 仓库远端：`https://github.com/zouyuxuan122/Deepseek-Harness-EAC.git`
  （本地 remote origin = 上游；fork 与 PR 同库处理）。
- 本地检出：`D:\dsh_working\Deepseek-Harness-EAC`（完整 git 仓库，含
  `dsh-desktop/`、`tauri-shell/`、`docs/` 等）。工作目录可能是其它值，
  以 `pwd` 为准，不要用检查路径代替。
- **GH Token 位置（本机事实）**：存放于**用户级环境变量 `GH_TOKEN`**
  （不是当前进程环境，新开的 pwsh 也不继承，需显式读取注入）：

  ```powershell
  $env:GH_TOKEN = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
  if ([string]::IsNullOrEmpty($env:GH_TOKEN)) { throw 'GH_TOKEN 用户级环境变量为空' }
  gh auth status        # 应显示 Token: gho_***（logging in via GH_TOKEN）
  ```

  - token 为 `gho_` 开头的 OAuth 令牌，有效期以用户更新为准；**不要在输出
    里回显完整 token**（可打印长度），**不要写死到任何脚本/仓库文件**。
  - 401 / 无权限时提示用户更新用户级环境变量 `GH_TOKEN` 后重试，不要绕过。
- **Rust 工具链**：本机 rustup 默认 GNU toolchain（`stable-x86_64-pc-windows-gnu`）；
  GNU 编译需要 `dlltool.exe`（binutils）。已通过 winget 安装 WinLibs
  （`BrechtSanders.WinLibs.POSIX.UCRT`），dlltool 位于：

  ```
  C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin
  ```

  未加入系统 PATH，跑 cargo 前先注入：

  ```powershell
  $env:PATH = 'C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin' + ';' + $env:PATH
  cargo check --manifest-path "$repo\tauri-shell\Cargo.toml"
  ```

  正式打包仍走 MSVC 工具链（本机未装 VS Build Tools，需要时告知用户，
  不要把 GNU 缺 dlltool 误判为源码失败）。
- **GitHub 源码形态没有编译产物**：`tauri-shell/src/main.rs` 用
  `include_str!("sidecar/bridge.js")` 嵌入 L2 产物；`tauri-build` 还会校验
  `tauri.conf.json` 的 `bundle.resources`（`staged-resources/`）存在性。
  因此在纯源码检出上验证 Rust 有两种方式：
  1. 正规：在 `dsh-desktop` 下 `npm ci` 后 `npm run build`（tsc 就地编译
     sidecar/*.ts → sidecar/*.js），再 `cargo check`；
  2. 快速（仅验证 Rust 源码）：临时创建空目录
     `tauri-shell/staged-resources/sidecar` 与
     `tauri-shell/staged-resources/dsh-desktop`，并在
     `tauri-shell/sidecar/bridge.js` 放占位文件（`include_str!` 仅编译期
     嵌入、不运行），`cargo check` 后**删除全部占位与临时目录**，确保
     `git status` 无 untracked 残留。

## 流程

### 1. 拉最新源码

- 检出不存在时：`git clone https://github.com/zouyuxuan122/Deepseek-Harness-EAC.git <检出路>`。
- 检出已存在时：

  ```powershell
  git -C <repo> fetch origin
  git -C <repo> status --short --branch     # 看 ahead/behind 与未提交修改
  git -C <repo> log --oneline -3 origin/main
  ```

- **保留用户已有未提交修改**：发现本地修改先把 `git -C <repo> diff`
  备份到独立目录（如 `D:\dsh_working\_local-changes-backup\<repo>-<时间戳>\`），
  未经用户明确授权不得丢弃本地修改；有未提交修改时禁止硬 `reset`/强删
  （用户明确说「全删」时例外，但仍先备份差异）。
- 本地落后于 `origin/main` 且用户要求最新源码：备份后重拉或 rebase，
  与用户确认后再继续。

### 2. 按用户要求改动

- 遵守 `deepseek-harness-eac-dev` 的 L1/L2/L3 边界与红线：不直接改
  `node_modules/@deepseek-ai/*`（受控补丁除外）、不动 DSH_HOME / profile /
  preset / sessions / skills 既有目录布局、不破坏 host/client 插件契约与
  bridge 契约；新业务优先 DSH 插件或 L2，不把原生能力塞进 Web 层。
- 改动聚焦单层单文件，同步更新 `dsh-desktop/CHANGELOG.md`（中文、与既有
  批次格式一致）；改动前先 `grep` 相关符号是否有契约测试/镜像实现。

### 3. 编译验证（自行完成，不做半成品交付）

- Rust L1：注入 dlltool PATH 后 `cargo check`；格式可加 `rustfmt --check`
  （解析错误会直接报出）。
- L2 / sidecar：`dsh-desktop` 下 `npm test`（需 node_modules）。
- 依据影响面选择最低充分验证：V1 定向 / V2 全量 / V3 壳契约 / V4 运行时
  GUI smoke / V5 打包。达不到完整验证时，明确列出「已验证」与「未验证」，
  不得把 V1 冒充跨层验收。
- 验证残留（占位文件、临时目录、编译中间态）必须清理，`git status` 复原。

### 4. 分支 + 提交 + PR（不直接动 main）

- 从最新 `origin/main` 开独立分支（`feat/` 或 `fix/` + 主题）：

  ```powershell
  git -C <repo> checkout -b feat/<主题> origin/main
  git -C <repo> add <文件>
  git -C <repo> commit -m "feat(<scope>): <中文描述>"
  ```

- 注入 GH_TOKEN 后推送并建 PR（标题/正文中文；正文用临时文件避免引号/编码）：

  ```powershell
  $env:GH_TOKEN = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
  git -C <repo> push -u origin feat/<主题>
  $body = @'
  ## 背景
  ...
  ## 改动
  ...
  ## 验证
  ...
  '@
  $bf = Join-Path $env:TEMP 'pr-body.md'
  Set-Content -Path $bf -Value $body -Encoding UTF8
  gh pr create --repo zouyuxuan122/Deepseek-Harness-EAC --base main `
    --head feat/<主题> --title "feat(<scope>): <中文标题>" --body-file $bf
  ```

- **绝不直接推 main / 共享分支**；PR 合并仅在用户明确授权时执行
  （`gh pr merge <N> --squash`）。

### 5. 汇报

- 说明：改动文件与内容、验证结果（命令与结论）、未验证项、PR 链接。
- 未经用户授权：不 commit、不 push、不合并、不发布、不打标签。

## 红线小结

- 不直接动 main；改动一律走独立分支 + PR。
- 用户本地修改先备份再处理；不覆盖用户自建插件、Skill、preset 或配置。
- 升级/迁移逻辑必须幂等、有边界、失败时保留旧数据。
- GH_TOKEN 只从用户级环境变量读取并显式注入，不回显、不落盘。
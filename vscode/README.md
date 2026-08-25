# DeepSeek Harness EAC — VS Code 插件版

在 VS Code 侧边栏中直接使用 [Deepseek-Harness-EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC)（v4Lite）的 DeepSeek Harness Web UI：点击侧边栏图标即可嵌入 DSH，插件自动启动（或复用）内置的 `dsh web` 服务 —— 代码与 AI 界面并排，无需切换终端、浏览器与 IDE。

> 本插件是仓库 `vscode-plugin` 分支的组成部分：**完整保留 lite-Windows 分支的全部内容**（桌面版 Electron 客户端、Tauri sidecar、内置插件资产、构建脚本、全部测试），在仓库根之上叠加了一个 VS Code 扩展前端（`vscode/` 子目录），与桌面版共享同一套内核、插件生态与数据目录。

## ✨ 特性

- 🖱️ **一键打开**：左侧活动栏与右侧辅助侧边栏各有一个 DSH EAC 图标，点击即在对应侧栏嵌入 DSH 页面；
- 🚀 **自动服务管理**：复用内置 Node 运行时（`vendor/node/node.exe`）与内置 dsh CLI（`node_modules/@deepseek-ai/dsh`）启动 `dsh web`，自动选择稳定端口（复用桌面版 `stable-port.js` 逻辑，不丢 Web UI 偏好）；已运行的 DSH 服务直接复用，不重复启动；
- 🔄 **万物皆插件**：启动前复用仓库根的 `desktop-core.js`（与桌面版同一模块、零行为漂移）把内置插件套件（插件市场 ×3 / 保护中心 / 启停管理 / 余额小部件 / 峰谷价格卫士 / 崩溃急救 / 右侧栏工作台 / 自动压缩 / 皮肤切换等 11 个）与 9 款皮肤同步进 profile 并幂等注册 `cordis.patch.yml` —— **和原版一样，用户可自定义接入各种插件**：Web UI 内插件市场安装、`dsh plugin add`、或直接编辑 profile 的 `cordis.patch.yml`；
- 🪟 **与桌面版无缝共存**：默认 `DSH_HOME = ~/.dsh-v4lite`、profile `web-desktop`（与原版 `~/.dsh` 隔离）；userData 目录与桌面版相同，settings 里的稳定端口共享，桌面版与插件版可同时运行、互不冲突；
- 🔄 **实时状态同步**：状态栏四态指示（运行中绿 / 启动中黄 / 失败红 / 已停止灰），点击开关面板；
- 🛟 **错误兜底**：内置运行时缺失、启动超时、进程崩溃、端口被占用各有专属错误页与一键重试；端口被其他程序占用时自动临时切换空闲端口；
- 🌐 **双语界面**：跟随 VS Code 显示语言（zh-* 中文，其余英文）；
- 🧹 **干净退出**：关闭窗口停止插件自启的服务（`taskkill /T` 进程树，不留孤儿进程）；手动启动的服务绝不触碰。

## 📥 安装

插件版依赖仓库根的内核与资产，**必须作为仓库的一部分使用**（不能脱离仓库单独分发）：

```bash
# 1. 克隆仓库并切换到本分支
git clone https://github.com/zouyuxuan122/Deepseek-Harness-EAC.git
cd Deepseek-Harness-EAC
git checkout vscode-plugin

# 2. 安装根依赖（含 patch-deps 钩子）+ 内置 Node 运行时
npm install
npm run fetch-runtime

# 3. 安装并编译插件
cd vscode
npm install
npm run compile

# 4. 在 VS Code 中打开 vscode/ 目录，F5 启动扩展开发宿主；
#    或打包成 vsix 后安装（推荐用开发宿主，因为插件复用仓库根资产）
```

## 🚀 使用

1. 安装后在左侧活动栏 / 右侧辅助侧边栏出现 DSH EAC 鲸鱼图标；
2. 点击图标：插件自动同步内置插件、启动（或复用）`dsh web` 并把页面嵌入侧栏；
3. 面板标题栏按钮：`在浏览器中打开` `重启服务` `停止服务` `复制网址` `查看日志`；
4. 底部状态栏显示服务状态，点击切换面板。

### 命令面板（`DSH EAC:` 前缀）

| 命令 | 说明 |
|---|---|
| `DSH EAC: Open Panel` | 打开左侧面板 |
| `DSH EAC: Open in Secondary Side Bar` | 在右侧辅助侧边栏打开 |
| `DSH EAC: Open in Browser` | 在系统浏览器打开 DSH 页面 |
| `DSH EAC: Restart Service` | 重启插件管理的服务 |
| `DSH EAC: Stop Service` | 停止插件启动的服务 |
| `DSH EAC: Copy URL` | 复制 DSH 页面网址 |
| `DSH EAC: Show Logs` | 打开插件日志输出通道 |
| `DSH EAC: Sync Built-in Plugins` | 手动重新同步内置插件/皮肤（万物皆插件） |
| `DSH EAC: Open Profile Folder` | 打开当前 profile 目录（可手改 cordis.patch.yml 自定义插件） |
| `DSH EAC: Open DSH Home` | 打开 DSH_HOME 目录 |

### 设置（`dshEac.*`）

| 设置 | 默认 | 说明 |
|---|---|---|
| `dshEac.port` | `0` | 期望端口；`0` = 自动复用 settings 中持久化的稳定端口 |
| `dshEac.autoStart` | `true` | 面板打开时自动启动服务 |
| `dshEac.stopOnExit` | `true` | VS Code 退出时停止插件自启的服务 |
| `dshEac.profile` | `web-desktop` | 运行的 profile；`web` = 官方共享 profile（与 dsh CLI 互通） |
| `dshEac.dshHome` | 空 | DSH_HOME；空 = 默认 `~/.dsh-v4lite`（环境变量 `DSH_HOME` 优先级更高） |
| `dshEac.syncBuiltinPlugins` | `true` | 启动前同步内置插件/皮肤（关闭则退回裸 dsh web） |
| `dshEac.extraArgs` | `[]` | 追加到 `dsh web` 命令的额外 CLI 参数 |
| `dshEac.patchOverlays` | `[]` | 额外 `--patch` overlay 文件（自定义插件补丁入口，万物皆插件） |
| `dshEac.openInBrowser` | `false` | 允许 dsh web 打开浏览器（默认 `--no-open`） |
| `dshEac.workspaceRootIndex` | `0` | 多根工作区取第几个根作为 dsh web 工作目录 |

## 🧪 测试

```bash
# 插件单元测试（编译 + node --test）
cd vscode
npm test

# 仓库全量测试（lite-Windows 原有 43 个测试，验证原内容不被破坏）
cd ..
npm test

# VS Code 集成测试（@vscode/test-electron 下载 VS Code，真实激活扩展并启动服务）
cd vscode
npm run integration
```

## 🔗 与桌面版（lite-Windows）的关系

| | 桌面版（Electron） | VS Code 插件版 |
|---|---|---|
| 服务启动 | main.js 内置运行时 + stable-port | 同一套：内置运行时 + stable-port（复用仓库根模块） |
| 插件生态 | syncCompanionPlugins（main.js） | 同一模块 `desktop-core.js`（Tauri sidecar 版，零行为漂移） |
| 数据目录 | `%APPDATA%\Deepseek Harness EAC v4Lite` | 相同（settings/稳定端口共享） |
| DSH_HOME | `~/.dsh-v4lite` | 相同（会话/API Key/插件互通） |
| profile | `web-desktop` | 相同（默认） |
| 万物皆插件 | ✅ | ✅（Web UI 插件市场 / cordis.patch.yml / --patch overlay 全部保留） |

## 📄 许可

MIT（与仓库一致）。图标沿用 [dsh-vscode](https://github.com/Fengze233/dsh-vscode)（MIT）。

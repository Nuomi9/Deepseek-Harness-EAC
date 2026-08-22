# Tauri 迁移 TypeScript 化设计（V-T 阶段）+ 修订执行路线

> 写于 2026-08-21。本文是 `docs/tauri-migration-plan-v2.md` 的增补：新增 V-T 阶段（sidecar 轨道
> TypeScript 化）并修订阶段顺序。v2 的采纳/拒绝清单、handoff 的技术坑仍然有效。
> 设计已经用户三轮确认批准（时机/共享模块策略/V-A 纳入/理念保全修正）。

---

## 一、最高原则：产品理念保全（优先级高于一切技术决策）

1. **功能零变化**：不新增、不删除、不修改任何用户可感知行为。窗口/托盘/插件市场/皮肤切换/
   余额查询/保护中心/preset 同步等全部原样保留。
2. **「万物皆插件」载体永不动**：`assets/` 下插件（10）、皮肤（9）、agent presets 本身就是 JS
   文件——它们是**产品内容**，不是壳层胶水代码，**永不 TS 化**。「抛弃大部分 JavaScript」仅指
   我们自己写的壳层编排代码。
3. **桌面侧「万物皆插件」实现逐语义保留**：desktop-core 的 COMPANION_PLUGINS 配套同步、同名
   迁移接管、patch 幂等注册、内置清单标记、市场排队任务、体检修复闭环，移植时逐函数对照原 JS，
   语义、错误处理方式（内部吞错记日志）、日志文本保持一致。

## 二、TS 化的本质（通俗定义）

**程序最终运行的仍然是 JavaScript**。TS 只是源码形态，经 tsc 编译为等价 JS 后由 Node 运行，
因此运行时行为差异在机制上不存在；唯一风险是移植手误，由测试锁死（7 条契约 + 关键模块单测 +
V-C 点检复跑）。收益全部在开发期：strict 类型检查编译期抓错、IDE 补全/跳转、未来重构有安全网。

## 三、用户已确认的三个决策

| 决策点 | 结论 |
|---|---|
| 重构时机 | 迁移收尾后再重构：V-B → V-A → V-C → V-D → V-E 全部用现有 JS 拿到已验证基线，然后 V-T |
| 共享模块策略 | sidecar 自持 TS 副本（`sidecar/src/`），根目录 .js 原样冻结给 Electron 轨 |
| V-A 安全收紧 | 纳入本轮，修完卡点测试就做 |

## 四、修订后的总体路线

```
V-B 修卡点测试 → V-A 安全收紧 → V-C 真机验证+基线度量 → V-D 打包(stage 用 TS 写)
→ V-E localStorage 迁移 → V-T sidecar TS 化 → 全量复验 → V-F/V-G 以 TS 构建版发布预览
```

V-F 的 14 天观察期针对 TS 构建版，避免发布 JS 预览版后立刻被替换。
新写代码一律 TS（如 V-D 的 stage 脚本）；既有已验证 JS 在 V-T 前不动。

## 五、V-T 设计

### 5.1 目录与产物

```
sidecar/
  tsconfig.json        # strict + noEmit 不适用——tsc 直接 emit；module=commonjs, target=ES2022
  build.mjs            # tsc 编译包装（npm run build:sidecar）
  src/
    shell-host.ts      # RPC 服务壳入口（对应 shell-host.js）
    desktop-core.ts    # 编排层（对应 desktop-core.js）
    lib/               # 11 个依赖模块的忠实移植：
                       #   updater / plugin-updater / balance / profile-module-heal /
                       #   plugin-guard / patch-row-heal / preset-sync /
                       #   plugin-manager-state / builtin-collision / koffi-preflight /
                       #   plugin-manager-patch(对应 scripts/plugin-manager-patch.js)
  test/                # 模块级 TS 单测（node --test 原生 strip-types，只用可擦除语法）
  dist/                # tsc 产物（gitignore），文件对文件映射 src/*.ts → dist/**/*.js
```

### 5.2 工具链：tsc 多文件 emit（已定）

- **文件对文件映射**：每个 TS 文件对应一个原 JS 文件，review 可逐文件审计「只换了语言」。
- 无打包器魔法：require 结构与现在完全相同；koffi/js-yaml 等运行时 require 行为不变。
- 产物进 `sidecar/dist/`，与根目录冻结 .js 无路径冲突；staging 拷 dist 目录即可。
- 类型检查即编译（tsc emit 自带检查），另提供 `--noEmit` 快检脚本。

### 5.3 移植顺序与行为锁

1. 叶子模块先行（plugin-manager-state/builtin-collision 等纯逻辑模块），每模块配 TS 单测；
2. 行为关键模块（preset-sync/plugin-guard/balance/patch-row-heal）对照旧 test/*.test.mjs
   用例移植 TS 版单测；
3. 最后 desktop-core.ts + shell-host.ts，7 条契约测试改指 `dist/shell-host.js`；
4. boot.rs/sidecar 启动路径改指新产物位置（dev=仓库根 sidecar/dist，packaged=resource 下同布局）；
5. 全量复验：npm test 连续 3 次绿 + cargo test 绿 + V-C 点检清单复跑通过。

### 5.4 边界

- ✅ 转：sidecar 13 个自有模块、stage 等新构建脚本、契约测试、新增单测。
- ❌ 不动：assets/、冻结 Electron 轨（main.js + 根目录共享 .js，V-F 观察期过后随版本删除）、
  220+ 旧 JS 测试（它们测的就是冻结轨道）、dsh 上游 CLI、RPC 帧格式、settings 双端写兼容。

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| 移植走样（语义漂移） | 逐文件对照审计 + 契约测试 + 模块单测 + 日志文本断言 |
| koffi 原生模块兼容 | 不打包、运行时 require 不变；koffiPreflight 逻辑逐行移植 |
| Node 运行时版本差异 | tsc target ES2022 / module commonjs，兼容内置 node.exe（系统 Node 复制机制） |
| dev/packaged 双布局路径分叉 | paths.rs 统一解析 sidecar/dist/shell-host.js，两布局同相对路径 |

## 七、验收标准（V-T 完成定义）

1. `sidecar/` 内自有源码 100% TS，dist 产物通过全部契约测试；
2. `npm test`（旧套件 + 新 TS 单测 + 契约测试）连续 3 次全绿（§5.2 两个预存失败除外）；
3. `cargo check && cargo test` 绿；
4. debug 构建 + DSH_DESKTOP_USERDATA 重定位真机点检清单全过；
5. 用户可感知行为与 V-E 基线无差异（点检清单逐项对照）。

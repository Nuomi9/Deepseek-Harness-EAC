// scripts/build.mjs — esbuild 构建脚本
// 用法：node scripts/build.mjs            # 构建扩展 + 测试
//       node scripts/build.mjs --test     # 只构建测试
//       node scripts/build.mjs --watch    # 监听模式
import { build, context } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const testOnly = process.argv.includes('--test');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
};

// 扩展入口：external vscode（由 VS Code 宿主提供）
const ext = {
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  external: ['vscode'],
  ...common,
};

// 卸载钩子入口：VS Code 卸载扩展时执行（node ./out/uninstall.js），随扩展包分发
const uninstall = {
  entryPoints: ['src/uninstall.ts'],
  outfile: 'out/uninstall.js',
  ...common,
};

// 测试入口：递归收集 test 目录下的 *.test.ts
const testEntries = readdirSync('test', { recursive: true })
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => join('test', f));
const tests = {
  entryPoints: testEntries,
  outdir: 'out/test',
  // 测试环境没有 VS Code 宿主，用本地桩替代 vscode 模块，
  // 使 config.ts 等引用 vscode 的模块可被 node --test 加载。
  alias: { vscode: join(process.cwd(), 'test/vscode-stub.ts') },
  ...common,
};

// 集成测试入口（在真实 VS Code 宿主中运行，由 scripts/run-integration.mjs 驱动；
// 不匹配 *.test.ts，避免被 node --test 收集）
const integration = {
  entryPoints: ['test/integration/extension.integration.ts'],
  outfile: 'out/test/integration/extension.integration.js',
  external: ['vscode'],
  ...common,
};

// 构建前清空 out/：删除的源文件不会以旧产物残留，避免 node --test 收集到失效产物
rmSync(join(process.cwd(), 'out'), { recursive: true, force: true });

const configs = testOnly ? [tests, uninstall] : [ext, tests, uninstall, integration];
if (watch) {
  await Promise.all(configs.map((c) => context(c).then((ctx) => ctx.watch())));
  console.log('watch 模式已启动');
} else {
  await Promise.all(configs.map((c) => build(c)));
  console.log('构建完成');
}

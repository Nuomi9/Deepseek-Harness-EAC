// 编译 frontend/chrome.ts → src/inject/chrome.js（IIFE，供 Rust include_str! 内嵌为
// WebView initialization script）。esbuild 单文件零依赖输出。
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'src', 'inject', 'chrome.js');
mkdirSync(dirname(out), { recursive: true });
await build({
  entryPoints: [join(root, 'frontend', 'chrome.ts')],
  outfile: out,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: false,
  legalComments: 'none',
});
console.log('[build-inject] wrote ' + out);

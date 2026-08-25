// V4 右键菜单（浏览器风格）接线回归：attachEditContextMenu 覆盖四类场景，
// 且主窗与浮窗都挂接。
//
// Task 6：lib/window.ts 去 electron 化——attachEditContextMenu /
// guardFloatWebContents（WebContents 强耦合）迁至顶层组合根侧
// host-electron/windows.ts（Electron 宿主实现）；断言随之迁移到新落点，
// 四类场景与主窗/浮窗挂接语义保持不变。lib/ 侧守「迁移完成度 + 宿主委托面」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windowSrc = readFileSync(join(root, 'lib', 'window.ts'), 'utf8');
const hostWindowsSrc = readFileSync(join(root, 'host-electron', 'windows.ts'), 'utf8');
const mainSrc = readFileSync(join(root, 'main.js'), 'utf8');

test('attachEditContextMenu 定义完整：编辑/图片/选区/导航四类场景（host-electron 落点）', () => {
  const i = hostWindowsSrc.indexOf('function attachEditContextMenu');
  assert.ok(i > 0, 'attachEditContextMenu 应存在于 host-electron/windows.ts');
  const body = hostWindowsSrc.slice(i, hostWindowsSrc.indexOf('\n}', i) + 2);
  // 编辑菜单七项 + 分隔（用户反馈截图中的完整列表）
  for (const [label, role] of [
    ['撤销', 'undo'], ['重做', 'redo'], ['剪切', 'cut'], ['复制', 'copy'],
    ['粘贴', 'paste'], ['删除', 'delete'], ['全选', 'selectAll'],
  ]) {
    assert.match(body, new RegExp(`label: '${label}', role: '${role}'`), `缺少菜单项 ${label}`);
  }
  assert.match(body, /flags\.canUndo !== false/, 'enabled 应跟随 editFlags');
  // 图片场景
  assert.match(body, /mediaType === 'image'/);
  assert.match(body, /copyImageAt/);
  assert.match(body, /downloadURL/);
  // 导航场景（Task 3 TS 化：新版 Electron 类型移除 role:'back'/'forward'，
  // 改为等价的显式 goBack/goForward click；语义不变。）
  assert.match(body, /goBack/);
  assert.match(body, /goForward/);
  assert.match(body, /role: 'reload'/);
  // 弹窗定位到事件坐标
  assert.match(body, /popup\(\{ window: win, x: params\.x, y: params\.y \}\)/);
});

test('主窗与浮窗都挂接右键菜单（host-electron 落点）', () => {
  const occurrences = hostWindowsSrc.match(/attachEditContextMenu\(/g) || [];
  assert.ok(occurrences.length >= 3, '定义 + 主窗 + 浮窗至少 3 处引用，实际 ' + occurrences.length);
  assert.match(hostWindowsSrc, /attachEditContextMenu\(win\.webContents\)/, '主窗/浮窗挂接');
  // 浮窗围栏同迁（独立 partition + 隔离语义见 createFloat 段）。
  assert.match(hostWindowsSrc, /function guardFloatWebContents/, 'guardFloatWebContents 应随迁');
});

test('lib/window.ts 已去 electron：菜单机制迁出 + 窗口操作薄委托宿主', () => {
  assert.ok(
    !windowSrc.includes('export function attachEditContextMenu'),
    'lib/window.ts 不应再定义 attachEditContextMenu（WebContents 强耦合，属宿主实现）',
  );
  assert.match(windowSrc, /host-electron\/windows\.ts/, 'lib/window.ts 文件头应注明去向');
  assert.match(windowSrc, /hostCtx\(\)\.windows\?\.createMain\(/, 'createWindow 应委托 createMain');
  assert.match(windowSrc, /hostCtx\(\)\.windows\?\.reloadMain\(\)/, 'reloadMainWindow 应委托 reloadMain');
  // Task 3/Task 7：main.js 为 tsc 编译产物（双引号 require）经 lib/window.js 接线
  // （打包产物存在性由 bundled-files 守护）。
  assert.ok(/require\(['"]\.\/lib\/window\.js['"]\)/.test(mainSrc), 'main.js must require lib/window.js');
});

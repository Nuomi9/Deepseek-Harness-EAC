import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Tauri 版 NSIS 钩子（tauri-app/nsis/installer-hooks.nsh）静态防呆测试。
// 与 Electron 侧 installer-nsh-*.test.mjs（守护 build/installer.nsh，冻结双轨）
// 平行；断言对象是 Tauri 打包实际加载的钩子文件。
//
// 锁定的关键不变量：
//  1. 进程清理覆盖本代（安装名+调试名）与三代旧版 Electron exe，且带 /F /T
//  2. 全程无 cmd 管道 / find / nsProcess（v4.2 安装界面挂死教训）
//  3. 等待循环保留有界语义（20 × 500ms，超时放行）
//  4. 旧代遗留快捷方式清理
//  5. 卸载询问默认「保留」数据（MB_DEFBUTTON2），只清 Tauri 自有数据目录，
//     绝不动 Electron 版数据（双轨并存），也绝不 RMDir $INSTDIR（误删风险）
//  6. 长路径兜底（robocopy /MIR）存在
//  7. 不使用尾部 StrCpy 截取比较（Electron 版 v3.0.0 长度错位事故的根因手法）

const nsh = fs.readFileSync(join(root, 'tauri-app', 'nsis', 'installer-hooks.nsh'), 'utf8');
const lines = nsh.split(/\r?\n/);

const CURRENT = ['Deepseek Harness EAC v4Lite.exe', 'dsh-desktop-lite.exe'];
const LEGACY = ['Deepseek Harness EAC.exe', 'Deepseek Harness EAC v2.0.exe', 'Deepseek Harness EAC v1.0.exe', 'DSH Desktop.exe'];

test('PREINSTALL：taskkill 覆盖本代与全部旧代 exe（/F /T）', () => {
  const start = lines.findIndex((l) => l.includes('!macro _dshKillAll'));
  const end = lines.findIndex((l, i) => i > start && l.trim() === '!macroend');
  const block = lines.slice(start, end + 1).join('\n');
  for (const app of [...CURRENT, ...LEGACY]) {
    assert.ok(block.includes(`taskkill /F /T /IM "${app}"`), `应杀 ${app}`);
  }
});

test('钩子全程无 cmd 管道 / find / nsProcess', () => {
  assert.ok(!/\|\s*find\b/i.test(nsh), '不得出现 | find');
  assert.ok(!/cmd\s*\/c/i.test(nsh), '不得经 cmd.exe 起管道');
  assert.ok(!/nsProcess::/i.test(nsh), '不得使用 nsProcess');
  // 管道符只允许出现在 MessageBox 标志组合里（MB_YESNO|...），不得出现在命令中。
  for (const l of lines.filter((x) => x.includes('|'))) {
    assert.match(l, /MB_(YESNO|OK|ICON|DEFBUTTON)/, `此行不应含管道符: ${l.trim()}`);
  }
});

test('等待循环保留有界语义（20 轮 × Sleep 500，超时放行）', () => {
  assert.ok(/\$1\s*>\s*20/.test(nsh), '应有 $1 > 20 的轮数上限');
  assert.ok(/Sleep\s+500/.test(nsh), '应有 Sleep 500 节流');
  assert.ok(/did not exit; continuing anyway/.test(nsh), '超时应放行继续安装');
  assert.ok(nsh.split('\n').filter((l) => l.includes('ExecToStack')).length >= 1, '应用 ExecToStack 无管道探测');
});

test('PREINSTALL：清理旧代遗留快捷方式', () => {
  assert.ok(nsh.includes('Delete "$DESKTOP\\Deepseek Harness EAC v2.0.lnk"'));
  assert.ok(nsh.includes('Delete "$SMPROGRAMS\\DSH Desktop.lnk"'));
});

test('卸载询问：默认保留（DEFBUTTON2），只清 Tauri 自有数据', () => {
  assert.match(nsh, /MB_DEFBUTTON2/, '默认按钮必须是「否」（保留）');
  assert.match(nsh, /com\.deepseek\.dsh\.desktop\.lite/, '应清理 Tauri userData');
  assert.match(nsh, /\.dsh-v4lite/, '应清理 v4Lite 隔离 DSH_HOME');
  assert.ok(!/APPDATA\\\\?Deepseek Harness EAC"/.test(nsh), '绝不动 Electron 版 %APPDATA% 数据');
  const wipeBlock = lines.findIndex((l) => l.includes('dshUnWipe:'));
  assert.ok(wipeBlock > 0, '应有卸载清理分支');
});

test('绝不 RMDir $INSTDIR（Tauri 自带旧版卸载负责文件树）', () => {
  assert.ok(!/RMDir\s+\/r\s+"\$INSTDIR"/.test(nsh), '钩子不得自行清空安装目录');
});

test('长路径兜底：robocopy 镜像存在', () => {
  assert.match(nsh, /robocopy/i);
  assert.match(nsh, /\/MIR/i);
});

test('不使用尾部 StrCpy 截取比较（v3.0.0 长度错位事故手法根除）', () => {
  assert.ok(!/StrCpy\s+\$\w+\s+\$INSTDIR\s+""\s+-\d+/.test(nsh), '不得出现 $INSTDIR 尾部截取比较');
});

test('四个 Tauri 钩子宏齐全', () => {
  for (const hook of ['NSIS_HOOK_PREINSTALL', 'NSIS_HOOK_POSTINSTALL', 'NSIS_HOOK_PREUNINSTALL', 'NSIS_HOOK_POSTUNINSTALL']) {
    assert.ok(lines.some((l) => l.includes(`!macro ${hook}`)), `应定义 ${hook}`);
  }
});

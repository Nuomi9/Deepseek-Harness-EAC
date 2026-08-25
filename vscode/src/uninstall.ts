// src/uninstall.ts — VS Code 卸载扩展时的自动清理钩子（package.json "uninstall" 字段）
// 约束：VS Code 在卸载扩展时用 Node 执行本脚本（不经过扩展宿主、无法 import 'vscode'），
// 只能使用 Node 内建 API；任何失败都不影响 VS Code 卸载流程（尽力而为、吞异常并打印诊断）。
//
// 职责：本扩展是 Deepseek-Harness-EAC 仓库的 VS Code 前端，复用的 desktop-core 会把
// 内置插件/皮肤同步进用户 DSH_HOME 的 profile。卸载插件时不做破坏性清理（用户的数据、
// 已同步插件都属于 DSH 生态，与桌面版共存），仅打印提示。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function main(): void {
  try {
    // 卸载标记：告诉用户数据留在哪里（与桌面版完全兼容）
    const msg = 'DSH EAC VS Code 扩展已卸载。你的 DSH_HOME 数据（会话、API Key、插件）完整保留。';
    const flagDir = process.env.TEMP;
    if (flagDir) writeFileSync(join(flagDir, 'dsh-eac-uninstalled.txt'), msg, 'utf8');
    console.log('[dsh-eac-uninstall] 已卸载。用户数据（DSH_HOME）保留未动。');
  } catch (err) {
    console.error('[dsh-eac-uninstall] 清理失败（不影响扩展卸载）:', String(err));
  }
}

main();

/**
 * host-electron/tray.ts — Electron 托盘宿主面（Task 6 Wave 3）。
 *
 * HostTray（lib/host-ctx.ts）的 Electron 实现：Tray/Menu 的原生机制在
 * Wave 2 从 lib/tray.ts 中立化剥离后在本文件落位（移植底本为 git HEAD 的
 * 原 createTray）。菜单结构化规格与点击语义经 lib/tray.ts 的
 * buildTrayMenuSpec / executeTrayAction（宿主中立）：
 *   · create()：托盘创建成功后置位 state.trayActive（托盘存在性判断统一
 *     走该标志；图标缺失等静默跳过时保持 false）；
 *   · 菜单项点击/勾选把 action（及 checkbox 新态）转发 executeTrayAction；
 *   · 托盘单击＝主窗可见则隐藏、否则 showMainWindow()；双击＝showMainWindow()
 *     （对齐原 Electron 实现）。
 *
 * 本文件属组合根侧；对 lib/ 的 import 方向合法（宿主消费中立模块）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Tray, Menu } from 'electron';
import type { MenuItem } from 'electron';
import { state } from '../lib/state.js';
import { hostCtx } from '../lib/host-ctx.js';
import type { HostTray } from '../lib/host-ctx.js';
import { buildTrayMenuSpec, executeTrayAction, showMainWindow } from '../lib/tray.js';
import type { TrayMenuItem } from '../lib/tray.js';

/** 托盘实例（模块内持有；存在性判断统一走 state.trayActive）。 */
let tray: Tray | null = null;

/** 托盘菜单模板：中立规格 → Electron MenuItemConstructorOptions。 */
function buildTemplate(): Electron.MenuItemConstructorOptions[] {
  return buildTrayMenuSpec().map((item: TrayMenuItem) => {
    if (item.type === 'separator') return { type: 'separator' };
    if (item.type === 'checkbox') {
      return {
        type: 'checkbox',
        // exactOptionalPropertyTypes：可选属性仅在存在时传入。
        ...(item.label !== undefined ? { label: item.label } : {}),
        ...(item.checked !== undefined ? { checked: item.checked } : {}),
        // 勾选新态由原生 checkbox 菜单项自动翻转后回传（对齐原实现）。
        click: (menuItem: MenuItem) => executeTrayAction(item.action, menuItem.checked),
      };
    }
    return {
      type: 'normal',
      ...(item.label !== undefined ? { label: item.label } : {}),
      click: () => executeTrayAction(item.action),
    };
  });
}

/** Electron 托盘宿主面（main.ts 装配段注入 initHostCtx）。 */
export function electronTray(): HostTray {
  return {
    create: () => {
      const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
      // 图标缺失静默跳过（state.trayActive 保持 false；lib/tray.ts 的
      // createTray 据此不打印「托盘已就绪」）。
      if (!fs.existsSync(iconPath)) return;
      tray = new Tray(iconPath);
      tray.setToolTip('Deepseek Harness EAC');
      tray.setContextMenu(Menu.buildFromTemplate(buildTemplate()));
      // 单击切换显隐；双击显示（对齐原 Electron 实现的托盘行为约定）。
      tray.on('click', () => {
        const w = hostCtx().windows;
        if (!w) return;
        if (w.isMainVisible()) w.hideMain();
        else showMainWindow();
      });
      tray.on('double-click', () => showMainWindow());
      state.trayActive = true;
    },
    destroy: () => {
      if (tray) {
        tray.destroy();
        tray = null;
      }
      state.trayActive = false;
    },
    // 仅 Windows 语义（HostTray 契约）；其余宿主静默——Electron 桌面本尊
    // 当前只发 Windows 构建，displayBalloon 原生可用。
    displayBalloon: (opts) => {
      // Electron 43 的 DisplayBalloonOptions.title 必填；契约侧可选时兜底空串。
      tray?.displayBalloon({
        title: opts.title ?? '',
        content: opts.content,
        iconType: 'info',
      });
    },
  };
}

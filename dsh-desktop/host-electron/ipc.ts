/**
 * host-electron/ipc.ts — Electron IPC 传输面适配器（Task 6 Wave 3）。
 *
 * lib/ipc/* 的 42 个 channel handler 注册面从 ipcMain 换成注入的 IpcSurface
 * （Task 6.1 传输面化）；本模块把 IpcSurface 映射回 Electron：
 *   · handle → ipcMain.handle（invoke 语义，返回值/异常回传渲染端）
 *   · on     → ipcMain.on（单向推送语义；handler 第二参才是 payload）
 *
 * 来源身份：IpcSender.sessionToken＝String(event.sender.id)（webContents.id），
 * 与宿主登记的 BridgeSession.id 同源 —— lib/ipc/sender.ts 的来源校验据此
 * 比对（主窗/向导/恢复中心/浮窗各持有互异且稳定的 token）。
 *
 * 本文件属组合根侧（host-electron/ 是 electron import 的合法装配点）；
 * lib/ 仍保持零 electron 依赖。
 */

import { ipcMain } from 'electron';
import type { IpcSurface, IpcEvent } from '../lib/ipc/transport.js';

/** Electron IPC 传输面（装配期注入 setDefaultIpcSurface，供 boot 链 registerIpc 取用）。 */
export function electronIpcSurface(): IpcSurface {
  return {
    handle: (channel, fn) => {
      ipcMain.handle(channel, (event, payload) => {
        const ev: IpcEvent = { sender: { sessionToken: String(event.sender.id) } };
        return fn(payload, ev);
      });
    },
    on: (channel, fn) => {
      // ipcMain.on 的 handler 第二参才是 payload（首参是 IpcMainEvent）。
      ipcMain.on(channel, (event, payload) => {
        const ev: IpcEvent = { sender: { sessionToken: String(event.sender.id) } };
        fn(payload, ev);
      });
    },
  };
}

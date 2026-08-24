/**
 * lib/ipc/snapshot.ts — 快照管理器域 IPC。
 *
 * channel：snapshot:overview / snapshot:create / snapshot:detail /
 * snapshot:restore / snapshot:branch-create / snapshot:branch-delete /
 * snapshot:branch-set-current / snapshot:config-save / snapshot:delete /
 * snapshot:gc。全部经 fromMainWindow 鉴权；业务实现在 lib/snapshot/manager.ts。
 */

import { ipcMain } from 'electron';
import { fromMainWindow } from './sender.js';
import * as manager from '../snapshot/manager.js';

/** 注册快照域全部 channel（boot 时经 lib/ipc/index.ts 统一调用）。 */
export function registerSnapshotIpc(): void {
  ipcMain.handle('snapshot:overview', (event) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.overview();
  });

  ipcMain.handle('snapshot:create', (event, { message } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    const msg = message === undefined ? undefined : String(message).slice(0, 200);
    return manager.createSnapshot(msg);
  });

  ipcMain.handle('snapshot:detail', (event, { id } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.snapshotDetail(String(id ?? ''));
  });

  ipcMain.handle('snapshot:restore', (event, { id, safety } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.restoreSnapshot(String(id ?? ''), safety !== false);
  });

  ipcMain.handle('snapshot:branch-create', (event, { name, fromId } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.createBranch(String(name ?? ''), fromId ? String(fromId) : undefined);
  });

  ipcMain.handle('snapshot:branch-delete', (event, { name } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.deleteBranch(String(name ?? ''));
  });

  ipcMain.handle('snapshot:branch-set-current', (event, { name } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.setCurrentBranch(String(name ?? ''));
  });

  ipcMain.handle('snapshot:config-save', (event, { config } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    if (!config || typeof config !== 'object') return { ok: false, error: 'bad-config' };
    return manager.saveConfig(config as Record<string, never>);
  });

  ipcMain.handle('snapshot:delete', (event, { id } = {}) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.deleteSnapshot(String(id ?? ''));
  });

  ipcMain.handle('snapshot:gc', (event) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
    return manager.gc();
  });
}

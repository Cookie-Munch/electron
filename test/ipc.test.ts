import { describe, it, expect, vi } from 'vitest';
import { createConsentManager } from '../src/manager.js';
import { memoryStore } from '../src/secure-store.js';
import {
  registerConsentIpc,
  exposeConsentBridge,
  getConsent,
  setConsent,
  onConsentChange,
  CONSENT_CHANNELS,
  DEFAULT_BRIDGE_KEY,
} from '../src/ipc.js';
import type {
  ContextBridgeLike,
  IpcMainLike,
  IpcRendererLike,
  WebContentsLike,
} from '../src/electron-types.js';

/**
 * A tiny in-process fake of Electron's IPC: main `handle`s and renderer `invoke`s route
 * through the same channel map, and `send` from main is delivered to renderer `on`
 * listeners. No real electron, no sockets.
 */
function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const rendererListeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();

  const ipcMain: IpcMainLike = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };

  const ipcRenderer: IpcRendererLike = {
    async invoke(channel, ...args) {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h({}, ...args);
    },
    on(channel, listener) {
      if (!rendererListeners.has(channel)) rendererListeners.set(channel, new Set());
      rendererListeners.get(channel)!.add(listener);
    },
    removeListener(channel, listener) {
      rendererListeners.get(channel)?.delete(listener);
    },
  };

  // A WebContents whose `send` fans out to the renderer's registered listeners.
  const webContents: WebContentsLike = {
    send(channel, ...args) {
      for (const l of rendererListeners.get(channel) ?? []) l({}, ...args);
    },
    isDestroyed: () => false,
  };

  return { ipcMain, ipcRenderer, webContents };
}

function fakeContextBridge(scope: Record<string, unknown>): ContextBridgeLike {
  return { exposeInMainWorld: (key, api) => void (scope[key] = api) };
}

describe('IPC bridge end to end', () => {
  it('renderer get/set round-trips through main and reaches the API client', async () => {
    const { ipcMain, ipcRenderer, webContents } = fakeIpc();
    const scope: Record<string, unknown> = {};

    const recordConsent = vi.fn(async () => {});
    const manager = createConsentManager({
      cbid: 'demo',
      store: memoryStore(),
      client: { recordConsent },
      now: () => 1,
      stamp: () => 's',
    });
    await manager.load();

    registerConsentIpc(ipcMain, manager, { getWebContents: () => [webContents] });
    exposeConsentBridge(fakeContextBridge(scope), ipcRenderer);

    // Renderer reads the implied default.
    const before = await getConsent({ scope });
    expect(before.method).toBe('implied');

    // Renderer sets choices; the decision flows to main -> ledger.
    const after = await setConsent({ preferences: true, statistics: false, marketing: true }, { scope });
    expect(after.marketing).toBe(true);
    expect(after.method).toBe('explicit');
    expect(recordConsent).toHaveBeenCalledTimes(1);
    expect(manager.getState().marketing).toBe(true);
  });

  it('pushes change events from main to renderer subscribers', async () => {
    const { ipcMain, ipcRenderer, webContents } = fakeIpc();
    const scope: Record<string, unknown> = {};
    const manager = createConsentManager({ cbid: 'demo', store: memoryStore() });
    await manager.load();

    registerConsentIpc(ipcMain, manager, { getWebContents: () => [webContents] });
    exposeConsentBridge(fakeContextBridge(scope), ipcRenderer);

    const cb = vi.fn();
    const off = onConsentChange(cb, { scope });

    await manager.accept();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toMatchObject({ marketing: true });

    off();
    await manager.decline();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('exposes the bridge under the default key and uses the documented channels', () => {
    const { ipcRenderer } = fakeIpc();
    const scope: Record<string, unknown> = {};
    exposeConsentBridge(fakeContextBridge(scope), ipcRenderer);
    expect(scope[DEFAULT_BRIDGE_KEY]).toBeTypeOf('object');
    expect(CONSENT_CHANNELS.get).toBe('cookiemunch:consent:get');
  });

  it('renderer helpers throw a clear error when the preload never exposed the bridge', async () => {
    await expect(getConsent({ scope: {} })).rejects.toThrow(/consent bridge not found/i);
  });

  it('dispose removes the handlers', async () => {
    const { ipcMain, ipcRenderer, webContents } = fakeIpc();
    const scope: Record<string, unknown> = {};
    const manager = createConsentManager({ cbid: 'demo', store: memoryStore() });
    await manager.load();
    const dispose = registerConsentIpc(ipcMain, manager, { getWebContents: () => [webContents] });
    exposeConsentBridge(fakeContextBridge(scope), ipcRenderer);

    await expect(getConsent({ scope })).resolves.toBeTruthy();
    dispose();
    await expect(getConsent({ scope })).rejects.toThrow(/no handler/);
  });
});

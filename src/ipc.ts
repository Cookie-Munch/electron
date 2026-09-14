/**
 * IPC bridge between the main-process ConsentManager and the renderer.
 *
 * Three pieces, matching Electron's three contexts:
 *   - `registerConsentIpc(ipcMain, manager, opts?)` — MAIN: exposes get/set/accept/
 *     decline handlers and pushes change events to renderers.
 *   - `exposeConsentBridge(contextBridge, ipcRenderer, opts?)` — PRELOAD: safely exposes
 *     a small consent API on `window` via the context bridge.
 *   - `createConsentBridge(opts?)` / `getConsent` / `setConsent` / `onConsentChange` —
 *     RENDERER: read/update consent over the exposed bridge.
 *
 * None of this imports electron; the electron objects are passed in by the caller (who
 * imports them in their own main/preload files), so this package builds without electron.
 */

import type {
  ContextBridgeLike,
  IpcMainLike,
  IpcRendererLike,
  WebContentsLike,
} from './electron-types.js';
import type { ConsentManager } from './manager.js';
import type { Choices, ConsentCategory, ConsentState } from './types.js';

/** Default IPC channel names. Override via options to avoid collisions. */
export const CONSENT_CHANNELS = {
  get: 'cookiemunch:consent:get',
  set: 'cookiemunch:consent:set',
  accept: 'cookiemunch:consent:accept',
  decline: 'cookiemunch:consent:decline',
  changed: 'cookiemunch:consent:changed',
} as const;

/** The default global key the bridge is exposed under (`window.cookieMunchConsent`). */
export const DEFAULT_BRIDGE_KEY = 'cookieMunchConsent';

export interface Channels {
  get: string;
  set: string;
  accept: string;
  decline: string;
  changed: string;
}

function resolveChannels(partial?: Partial<Channels>): Channels {
  return { ...CONSENT_CHANNELS, ...partial };
}

export interface RegisterConsentIpcOptions {
  channels?: Partial<Channels>;
  /**
   * Returns the WebContents to push `changed` events to (typically your open windows'
   * `webContents`, or `webContents.getAllWebContents()`). Destroyed contents are skipped.
   */
  getWebContents?: () => WebContentsLike[];
}

/**
 * Wire the manager into `ipcMain`. Returns a disposer that removes the handlers and the
 * change subscription.
 */
export function registerConsentIpc(
  ipcMain: IpcMainLike,
  manager: ConsentManager,
  opts: RegisterConsentIpcOptions = {},
): () => void {
  const ch = resolveChannels(opts.channels);

  ipcMain.handle(ch.get, () => manager.getState());
  ipcMain.handle(ch.set, (_event, choices) => manager.set(choices as Choices));
  ipcMain.handle(ch.accept, () => manager.accept());
  ipcMain.handle(ch.decline, () => manager.decline());

  const off = manager.onChange((state) => {
    const targets = opts.getWebContents?.() ?? [];
    for (const wc of targets) {
      if (wc.isDestroyed?.()) continue;
      try {
        wc.send(ch.changed, state);
      } catch {
        /* a dead renderer must not break the loop */
      }
    }
  });

  return () => {
    off();
    ipcMain.removeHandler?.(ch.get);
    ipcMain.removeHandler?.(ch.set);
    ipcMain.removeHandler?.(ch.accept);
    ipcMain.removeHandler?.(ch.decline);
  };
}

/** The consent API exposed to the renderer's `window`. */
export interface ConsentBridgeApi {
  get(): Promise<ConsentState>;
  set(choices: Choices): Promise<ConsentState>;
  accept(): Promise<ConsentState>;
  decline(): Promise<ConsentState>;
  /** Subscribe to change events pushed from main; returns an unsubscribe function. */
  onChange(cb: (state: ConsentState) => void): () => void;
}

export interface ExposeConsentBridgeOptions {
  channels?: Partial<Channels>;
  /** Global key on `window`. Defaults to {@link DEFAULT_BRIDGE_KEY}. */
  key?: string;
}

/**
 * Build the renderer-facing API object over an `ipcRenderer`. Exposed for advanced
 * preload setups; most callers use {@link exposeConsentBridge}.
 */
export function createConsentBridgeApi(
  ipcRenderer: IpcRendererLike,
  opts: ExposeConsentBridgeOptions = {},
): ConsentBridgeApi {
  const ch = resolveChannels(opts.channels);
  return {
    get: () => ipcRenderer.invoke(ch.get) as Promise<ConsentState>,
    set: (choices) => ipcRenderer.invoke(ch.set, choices) as Promise<ConsentState>,
    accept: () => ipcRenderer.invoke(ch.accept) as Promise<ConsentState>,
    decline: () => ipcRenderer.invoke(ch.decline) as Promise<ConsentState>,
    onChange: (cb) => {
      const listener = (_event: unknown, state: unknown) => cb(state as ConsentState);
      ipcRenderer.on(ch.changed, listener);
      return () => ipcRenderer.removeListener(ch.changed, listener);
    },
  };
}

/**
 * PRELOAD: expose the consent API on `window[key]` (default `cookieMunchConsent`) via
 * the context bridge. Call this from a `contextIsolation: true` preload script.
 */
export function exposeConsentBridge(
  contextBridge: ContextBridgeLike,
  ipcRenderer: IpcRendererLike,
  opts: ExposeConsentBridgeOptions = {},
): void {
  const key = opts.key ?? DEFAULT_BRIDGE_KEY;
  contextBridge.exposeInMainWorld(key, createConsentBridgeApi(ipcRenderer, opts));
}

export interface RendererBridgeOptions {
  /** Global key the bridge was exposed under. Defaults to {@link DEFAULT_BRIDGE_KEY}. */
  key?: string;
  /** The object to read the bridge from. Defaults to `globalThis`/`window`. */
  scope?: Record<string, unknown>;
}

function resolveBridge(opts: RendererBridgeOptions = {}): ConsentBridgeApi {
  const key = opts.key ?? DEFAULT_BRIDGE_KEY;
  const scope = opts.scope ?? (globalThis as Record<string, unknown>);
  const bridge = scope[key] as ConsentBridgeApi | undefined;
  if (!bridge) {
    throw new Error(
      `Cookie Munch consent bridge not found on window.${key}. Did the preload call exposeConsentBridge()?`,
    );
  }
  return bridge;
}

/** RENDERER: read the current consent state over the exposed bridge. */
export async function getConsent(opts?: RendererBridgeOptions): Promise<ConsentState> {
  return resolveBridge(opts).get();
}

/** RENDERER: record explicit choices over the exposed bridge. */
export async function setConsent(choices: Choices, opts?: RendererBridgeOptions): Promise<ConsentState> {
  return resolveBridge(opts).set(choices);
}

/** RENDERER: subscribe to consent changes pushed from the main process. */
export function onConsentChange(
  cb: (state: ConsentState) => void,
  opts?: RendererBridgeOptions,
): () => void {
  return resolveBridge(opts).onChange(cb);
}

/**
 * RENDERER: a {@link import('./gate.js').ConsentSource}-compatible view over the bridge,
 * for use with {@link import('./gate.js').createConsentGate} in the renderer.
 */
export function bridgeConsentSource(opts?: RendererBridgeOptions): {
  getState(): Promise<ConsentState>;
  onChange(cb: (state: ConsentState) => void): () => void;
} {
  const bridge = resolveBridge(opts);
  return { getState: () => bridge.get(), onChange: (cb) => bridge.onChange(cb) };
}

export type { ConsentCategory };

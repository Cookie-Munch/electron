/**
 * @cookiemunch/electron — the Cookie Munch SDK for Electron desktop apps.
 *
 * Gives desktop apps the same consent capture + gating + auditable ledger record as the
 * web embed and the React Native SDK, respecting Electron's main/renderer split:
 *   - MAIN:     createConsentManager(...) + registerConsentIpc(ipcMain, manager)
 *   - PRELOAD:  exposeConsentBridge(contextBridge, ipcRenderer)
 *   - RENDERER: getConsent() / setConsent() / onConsentChange() + createConsentGate(...)
 *
 * `electron` is an OPTIONAL peer dependency, loaded lazily — this package builds and
 * type-checks with electron NOT installed.
 */

// Types
export type {
  Choices,
  ConsentState,
  ConsentMethod,
  ConsentCategory,
  OptInCategory,
} from './types.js';

// Main-process manager
export { createConsentManager } from './manager.js';
export type { ConsentManager, ConsentManagerOptions } from './manager.js';

// Persistence
export { electronSafeStore, memoryStore } from './secure-store.js';
export type { SecureStore, ElectronSafeStoreOptions } from './secure-store.js';

// Ledger API client
export { createConsentApiClient } from './api.js';
export type { ConsentApiClient, ConsentApiClientOptions, ConsentRecordPayload } from './api.js';

// Gating (prior-blocking equivalent)
export { createConsentGate } from './gate.js';
export type { ConsentGate, ConsentSource } from './gate.js';

// IPC bridge
export {
  registerConsentIpc,
  exposeConsentBridge,
  createConsentBridgeApi,
  getConsent,
  setConsent,
  onConsentChange,
  bridgeConsentSource,
  CONSENT_CHANNELS,
  DEFAULT_BRIDGE_KEY,
} from './ipc.js';
export type {
  ConsentBridgeApi,
  Channels,
  RegisterConsentIpcOptions,
  ExposeConsentBridgeOptions,
  RendererBridgeOptions,
} from './ipc.js';

// Electron structural types (no electron import required to consume them)
export type {
  ElectronMainModule,
  SafeStorageLike,
  IpcMainLike,
  IpcRendererLike,
  ContextBridgeLike,
  WebContentsLike,
  AppLike,
} from './electron-types.js';

// The full typed REST client, re-exported for desktop dashboards/reads.
export { createCookieMunch, CookieMunchApiError } from '@cookiemunch/sdk';
export type { CookieMunchClient, CookieMunchOptions } from '@cookiemunch/sdk';

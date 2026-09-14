/**
 * Minimal STRUCTURAL types for the small slice of Electron this SDK touches.
 *
 * We deliberately do NOT `import` (not even `import type`) from 'electron': the package
 * must build and type-check WITHOUT electron installed, and electron must stay out of
 * the dependency graph. Electron's real objects (`safeStorage`, `ipcMain`,
 * `ipcRenderer`, `contextBridge`, `app`, a `WebContents`) all satisfy these interfaces
 * duck-typed, so callers pass them straight through with no casts.
 */

/** Subset of Electron's `safeStorage`. Buffers are structurally `Uint8Array`. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
}

/** Subset of Electron's `app` used to locate the per-user data directory. */
export interface AppLike {
  getPath(name: string): string;
}

/** The pieces of the Electron main module the default secure store lazily loads. */
export interface ElectronMainModule {
  safeStorage: SafeStorageLike;
  app: AppLike;
}

/** Subset of Electron's `ipcMain`. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler?(channel: string): void;
}

/** Subset of a `WebContents` — enough to push change events to a renderer. */
export interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void;
  isDestroyed?(): boolean;
}

/** Subset of Electron's `ipcRenderer`. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

/** Subset of Electron's `contextBridge`. */
export interface ContextBridgeLike {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

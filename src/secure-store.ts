/**
 * Pluggable persistence for the consent decision. Mirrors the React Native SDK's
 * injectable `MobileStorage`: the ConsentManager reads/writes a single opaque string
 * and does not care how it is stored, so tests inject an in-memory store and real apps
 * use {@link electronSafeStore}.
 */

import type { ElectronMainModule, SafeStorageLike } from './electron-types.js';

/** A minimal string-blob store. Sync or async is fine. */
export interface SecureStore {
  read(): string | null | Promise<string | null>;
  write(value: string): void | Promise<void>;
}

/** An always-in-memory store — handy for tests and headless usage. */
export function memoryStore(): SecureStore {
  let value: string | null = null;
  return {
    read: () => value,
    write: (v) => {
      value = v;
    },
  };
}

export interface ElectronSafeStoreOptions {
  /**
   * The Electron main module (`{ safeStorage, app }`). Optional: when omitted it is
   * loaded lazily via `import('electron')` on first use, so importing this file never
   * requires electron to be installed. Pass it explicitly to avoid the dynamic import.
   */
  electron?: ElectronMainModule;
  /**
   * Directory for the consent file. Defaults to `app.getPath('userData')`.
   */
  dir?: string;
  /** Base filename (without extension). Defaults to `cookiemunch-consent`. */
  fileName?: string;
}

const ENC_MARKER = 'cm-safestorage-v1:';

/**
 * The default main-process store. Uses Electron's OS-backed `safeStorage` to encrypt
 * the consent blob at rest, and transparently falls back to a plaintext JSON file when
 * encryption is unavailable (e.g. Linux without a keyring). Both live under the app's
 * `userData` directory.
 *
 * Electron and `node:fs` are loaded lazily so this package builds without electron and
 * so the bundle stays tree-shakeable for renderer-only consumers.
 */
export function electronSafeStore(opts: ElectronSafeStoreOptions = {}): SecureStore {
  let resolved: Promise<{ file: string; safeStorage: SafeStorageLike | null }> | null = null;

  async function resolve() {
    if (resolved) return resolved;
    resolved = (async () => {
      // Indirect specifier: keeps the compiler/bundler from statically resolving
      // 'electron', so this package builds and type-checks WITHOUT electron installed.
      // At runtime (inside an Electron app) the module is always present.
      const electronSpecifier = 'electron';
      const electron =
        opts.electron ?? ((await import(electronSpecifier)) as unknown as ElectronMainModule);
      const path = await import('node:path');
      const dir = opts.dir ?? electron.app.getPath('userData');
      const file = path.join(dir, `${opts.fileName ?? 'cookiemunch-consent'}.json`);
      // Guard access: some contexts expose `safeStorage` but with encryption off.
      let safe: SafeStorageLike | null = null;
      try {
        safe = electron.safeStorage.isEncryptionAvailable() ? electron.safeStorage : null;
      } catch {
        safe = null;
      }
      return { file, safeStorage: safe };
    })();
    return resolved;
  }

  return {
    async read() {
      const { file, safeStorage } = await resolve();
      const fs = await import('node:fs/promises');
      let raw: string;
      try {
        raw = await fs.readFile(file, 'utf8');
      } catch {
        return null; // no file yet
      }
      if (raw.startsWith(ENC_MARKER)) {
        if (!safeStorage) return null; // encrypted blob but no key available anymore
        try {
          const bytes = Buffer.from(raw.slice(ENC_MARKER.length), 'base64');
          return safeStorage.decryptString(bytes);
        } catch {
          return null; // corrupt / undecryptable
        }
      }
      return raw; // plaintext fallback
    },
    async write(value) {
      const { file, safeStorage } = await resolve();
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (safeStorage) {
        const enc = safeStorage.encryptString(value);
        await fs.writeFile(file, ENC_MARKER + Buffer.from(enc).toString('base64'), 'utf8');
      } else {
        await fs.writeFile(file, value, 'utf8');
      }
    },
  };
}

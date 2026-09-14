import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { electronSafeStore, memoryStore } from '../src/secure-store.js';
import type { ElectronMainModule } from '../src/electron-types.js';

/** A fake safeStorage that "encrypts" by XOR-ing — enough to prove the round-trip and
 *  that the file on disk is NOT the plaintext. */
function fakeElectron(dir: string, encryptionAvailable = true): ElectronMainModule {
  return {
    app: { getPath: () => dir },
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (s) => {
        const bytes = Buffer.from(s, 'utf8');
        return Uint8Array.from(bytes.map((b) => b ^ 0x5a));
      },
      decryptString: (enc) => {
        const bytes = Buffer.from(enc).map((b) => b ^ 0x5a);
        return Buffer.from(bytes).toString('utf8');
      },
    },
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cm-electron-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('memoryStore', () => {
  it('round-trips a value', async () => {
    const s = memoryStore();
    expect(await s.read()).toBeNull();
    await s.write('hello');
    expect(await s.read()).toBe('hello');
  });
});

describe('electronSafeStore (encrypted)', () => {
  it('round-trips through safeStorage and stores ciphertext on disk', async () => {
    const store = electronSafeStore({ electron: fakeElectron(dir) });
    await store.write('{"marketing":true}');
    expect(await store.read()).toBe('{"marketing":true}');

    const onDisk = await readFile(join(dir, 'cookiemunch-consent.json'), 'utf8');
    expect(onDisk).not.toContain('marketing'); // encrypted at rest
    expect(onDisk.startsWith('cm-safestorage-v1:')).toBe(true);
  });

  it('returns null before anything is written', async () => {
    const store = electronSafeStore({ electron: fakeElectron(dir) });
    expect(await store.read()).toBeNull();
  });
});

describe('electronSafeStore (plaintext fallback)', () => {
  it('writes plaintext when encryption is unavailable and reads it back', async () => {
    const store = electronSafeStore({ electron: fakeElectron(dir, false) });
    await store.write('{"statistics":true}');
    expect(await store.read()).toBe('{"statistics":true}');

    const onDisk = await readFile(join(dir, 'cookiemunch-consent.json'), 'utf8');
    expect(onDisk).toBe('{"statistics":true}');
  });
});

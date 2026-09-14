import { describe, it, expect, vi } from 'vitest';
import { createConsentManager } from '../src/manager.js';
import type { ConsentApiClient, ConsentRecordPayload } from '../src/api.js';
import type { SecureStore } from '../src/secure-store.js';

function memStore(initial: string | null = null): SecureStore & { value: string | null } {
  const store = {
    value: initial,
    read() {
      return store.value;
    },
    write(v: string) {
      store.value = v;
    },
  };
  return store;
}

function fakeClient() {
  const sent: ConsentRecordPayload[] = [];
  const client: ConsentApiClient = {
    recordConsent: vi.fn(async (p: ConsentRecordPayload) => {
      sent.push(p);
    }),
  };
  return { client, sent };
}

function setup(over: { store?: SecureStore; client?: ConsentApiClient } = {}) {
  const store = over.store ?? memStore();
  const { client, sent } = fakeClient();
  const manager = createConsentManager({
    cbid: 'demo',
    store,
    client: over.client ?? client,
    region: 'gb',
    now: () => 1000,
    stamp: () => 'stamp-1',
  });
  return { manager, store, client, sent };
}

describe('defaults', () => {
  it('starts as an implied default with no explicit response', async () => {
    const { manager } = setup();
    await manager.load();
    const s = manager.getState();
    expect(s.necessary).toBe(true);
    expect(s.marketing).toBe(false);
    expect(s.method).toBe('implied');
    expect(manager.hasResponse()).toBe(false);
  });
});

describe('persist / restore', () => {
  it('persists a decision to the store', async () => {
    const { manager, store } = setup();
    await manager.load();
    await manager.accept();
    expect(String((store as ReturnType<typeof memStore>).value)).toContain('"marketing":true');
  });

  it('restores a previously persisted decision into a fresh manager', async () => {
    const store = memStore();
    const first = createConsentManager({ cbid: 'demo', store, apiUrl: undefined });
    await first.load();
    await first.set({ preferences: true, statistics: false, marketing: true });

    const second = createConsentManager({ cbid: 'demo', store });
    const restored = await second.load();
    expect(restored.preferences).toBe(true);
    expect(restored.statistics).toBe(false);
    expect(restored.marketing).toBe(true);
    expect(second.hasResponse()).toBe(true);
  });

  it('keeps the implied default when the stored blob is corrupt', async () => {
    const { manager } = setup({ store: memStore('not json') });
    const s = await manager.load();
    expect(s.method).toBe('implied');
  });
});

describe('accept / decline / set', () => {
  it('accept grants every category and is explicit', async () => {
    const { manager } = setup();
    await manager.load();
    const s = await manager.accept();
    expect(s).toMatchObject({ preferences: true, statistics: true, marketing: true, method: 'explicit' });
    expect(manager.hasResponse()).toBe(true);
  });

  it('decline denies every non-necessary category', async () => {
    const { manager } = setup();
    await manager.load();
    const s = await manager.decline();
    expect(s).toMatchObject({ preferences: false, statistics: false, marketing: false, necessary: true, method: 'explicit' });
  });
});

describe('onChange', () => {
  it('fires on each decision and can unsubscribe', async () => {
    const { manager } = setup();
    await manager.load();
    const cb = vi.fn();
    const off = manager.onChange(cb);
    cb.mockClear(); // ignore the emit from load
    await manager.accept();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toMatchObject({ marketing: true });
    off();
    await manager.decline();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('ledger sync', () => {
  it('sends the decision to the API client', async () => {
    const { manager, sent } = setup();
    await manager.load();
    await manager.accept();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      cbid: 'demo',
      stamp: 'stamp-1',
      method: 'explicit',
      region: 'gb',
      url: 'app://demo',
      choices: { preferences: true, statistics: true, marketing: true },
    });
  });

  it('omits subjectId from the ledger payload when not configured', async () => {
    const { manager, sent } = setup();
    await manager.load();
    await manager.accept();
    expect(sent[0]).not.toHaveProperty('subjectId');
  });

  it('includes a configured subjectId in the ledger payload', async () => {
    const { client, sent } = fakeClient();
    const manager = createConsentManager({
      cbid: 'demo',
      store: memStore(),
      client,
      region: 'gb',
      subjectId: 'user-42',
      now: () => 1000,
      stamp: () => 'stamp-1',
    });
    await manager.load();
    await manager.accept();
    expect(sent[0]).toMatchObject({ subjectId: 'user-42' });
  });

  it('never throws or loses the local decision when the API client fails (offline)', async () => {
    const failing: ConsentApiClient = {
      recordConsent: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const { manager, store } = setup({ client: failing });
    await manager.load();
    const s = await manager.accept(); // must not throw
    expect(s.marketing).toBe(true);
    expect(String((store as ReturnType<typeof memStore>).value)).toContain('"marketing":true');
  });

  it('does not sync when no client/apiUrl is configured', async () => {
    const manager = createConsentManager({ cbid: 'demo', store: memStore() });
    await manager.load();
    await expect(manager.accept()).resolves.toMatchObject({ marketing: true });
  });
});

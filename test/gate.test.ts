import { describe, it, expect, vi } from 'vitest';
import { createConsentManager } from '../src/manager.js';
import { createConsentGate } from '../src/gate.js';
import { memoryStore } from '../src/secure-store.js';
import type { ConsentState } from '../src/types.js';

function newManager() {
  return createConsentManager({ cbid: 'demo', store: memoryStore(), now: () => 1, stamp: () => 's' });
}

describe('gate', () => {
  it('does NOT run before consent, and runs once consent is granted', async () => {
    const manager = newManager();
    await manager.load();
    const init = vi.fn();

    manager.gate('statistics', init);
    expect(init).not.toHaveBeenCalled(); // implied default: not consented

    await manager.decline();
    expect(init).not.toHaveBeenCalled(); // still not consented

    await manager.accept();
    expect(init).toHaveBeenCalledTimes(1); // now granted -> runs
  });

  it('runs immediately when consent is already granted', async () => {
    const manager = newManager();
    await manager.load();
    await manager.accept();

    const init = vi.fn();
    manager.whenConsented('marketing', init);
    // getState is sync here, but the gate reads it via a resolved promise
    await Promise.resolve();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('runs at most once even across multiple grants', async () => {
    const manager = newManager();
    await manager.load();
    const init = vi.fn();
    manager.gate('preferences', init);

    await manager.accept();
    await manager.set({ preferences: true, statistics: true, marketing: true });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled before consent is granted', async () => {
    const manager = newManager();
    await manager.load();
    const init = vi.fn();
    const cancel = manager.gate('statistics', init);
    cancel();
    await manager.accept();
    expect(init).not.toHaveBeenCalled();
  });

  it('treats `necessary` as always granted', async () => {
    const manager = newManager();
    await manager.load();
    const init = vi.fn();
    manager.gate('necessary', init);
    await Promise.resolve();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('isConsented reflects the current state', async () => {
    const manager = newManager();
    await manager.load();
    expect(await manager.isConsented('statistics')).toBe(false);
    await manager.accept();
    expect(await manager.isConsented('statistics')).toBe(true);
  });
});

describe('createConsentGate over an arbitrary source', () => {
  it('works with a plain async source', async () => {
    let state: ConsentState = {
      necessary: true,
      preferences: false,
      statistics: false,
      marketing: false,
      method: 'implied',
      stamp: 'x',
      ver: 1,
      utc: 0,
      region: 'gb',
    };
    const listeners = new Set<(s: ConsentState) => void>();
    const gate = createConsentGate({
      getState: async () => state,
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    });

    const init = vi.fn();
    gate.gate('marketing', init);
    await Promise.resolve();
    expect(init).not.toHaveBeenCalled();

    state = { ...state, marketing: true };
    for (const cb of listeners) cb(state);
    expect(init).toHaveBeenCalledTimes(1);
  });
});

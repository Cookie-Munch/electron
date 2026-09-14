/**
 * Main-process consent manager. Mirrors @cookiemunch/react-native's consent client:
 * an implied default until the user decides, a pluggable secure store for persistence,
 * change subscriptions, and best-effort sync to the Cookie Munch ledger. API failures
 * are swallowed — a decision is NEVER lost just because the machine is offline.
 *
 * Runs in the Electron MAIN process. It has no electron imports of its own; the only
 * electron-touching piece is the default secure store, which is loaded lazily.
 */

import { createConsentApiClient, type ConsentApiClient } from './api.js';
import { electronSafeStore, type SecureStore } from './secure-store.js';
import { createConsentGate, type ConsentGate } from './gate.js';
import type { Choices, ConsentCategory, ConsentState } from './types.js';

export interface ConsentManagerOptions {
  /** The Cookie Munch site id (cbid) this desktop app reports under. */
  cbid: string;
  /** API origin for the ledger, e.g. "https://cmp.example.com". Omit to disable sync. */
  apiUrl?: string;
  /** A custom API client. Overrides `apiUrl`. Injectable for tests. */
  client?: ConsentApiClient;
  /** Where the decision is persisted. Defaults to {@link electronSafeStore}. */
  store?: SecureStore;
  /** Best-effort region hint recorded with the decision. */
  region?: string;
  /**
   * Optional, app-supplied STABLE cross-surface subject id (e.g. a logged-in account id).
   * When set, it is included with every recorded decision so an org can correlate one
   * subject's consent across web + mobile + desktop. Omitted when absent.
   */
  subjectId?: string;
  /** Storage-schema/decision version. Defaults to 1. */
  ver?: number;
  fetch?: typeof fetch;
  now?: () => number;
  stamp?: () => string;
}

export interface ConsentManager extends ConsentGate {
  /** Restore any persisted decision. Call once during app startup. */
  load(): Promise<ConsentState>;
  /** The current in-memory state (implied default until `load`/a decision). */
  getState(): ConsentState;
  /** Record an explicit custom set of choices. */
  set(choices: Choices): Promise<ConsentState>;
  /** Grant every category. */
  accept(): Promise<ConsentState>;
  /** Deny every non-necessary category. */
  decline(): Promise<ConsentState>;
  /** True once the user has made an explicit decision. */
  hasResponse(): boolean;
  /** Subscribe to state changes; returns an unsubscribe function. */
  onChange(cb: (state: ConsentState) => void): () => void;
}

function randomStamp(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createConsentManager(opts: ConsentManagerOptions): ConsentManager {
  const now = opts.now ?? (() => Date.now());
  const region = opts.region ?? 'unknown';
  const ver = opts.ver ?? 1;
  const store = opts.store ?? electronSafeStore();
  const client =
    opts.client ??
    (opts.apiUrl ? createConsentApiClient({ apiUrl: opts.apiUrl, fetch: opts.fetch }) : null);
  const listeners = new Set<(s: ConsentState) => void>();

  let state: ConsentState = {
    necessary: true,
    preferences: false,
    statistics: false,
    marketing: false,
    method: 'implied',
    stamp: opts.stamp?.() ?? randomStamp(),
    ver,
    utc: now(),
    region,
  };

  function emit(): void {
    for (const cb of Array.from(listeners)) {
      try {
        cb(state);
      } catch {
        /* a listener error must never break consent */
      }
    }
  }

  async function persist(): Promise<void> {
    try {
      await store.write(JSON.stringify(state));
    } catch {
      /* persistence failure must not throw out of a decision */
    }
  }

  async function sync(): Promise<void> {
    if (!client) return;
    try {
      await client.recordConsent({
        cbid: opts.cbid,
        stamp: state.stamp,
        choices: { preferences: state.preferences, statistics: state.statistics, marketing: state.marketing },
        method: state.method,
        ver: state.ver,
        utc: state.utc,
        url: `app://${opts.cbid}`,
        region: state.region,
        ...(opts.subjectId ? { subjectId: opts.subjectId } : {}),
      });
    } catch {
      // offline — the local persist already captured the decision; retry later.
    }
  }

  async function commit(choices: Choices): Promise<ConsentState> {
    state = { ...state, ...choices, necessary: true, method: 'explicit', stamp: opts.stamp?.() ?? randomStamp(), utc: now() };
    await persist();
    emit();
    await sync();
    return state;
  }

  const gate = createConsentGate({
    getState: () => state,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  });

  return {
    async load() {
      let raw: string | null;
      try {
        raw = await store.read();
      } catch {
        raw = null;
      }
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<ConsentState>;
          state = {
            necessary: true,
            preferences: !!parsed.preferences,
            statistics: !!parsed.statistics,
            marketing: !!parsed.marketing,
            method: parsed.method === 'explicit' ? 'explicit' : 'implied',
            stamp: typeof parsed.stamp === 'string' ? parsed.stamp : state.stamp,
            ver: typeof parsed.ver === 'number' ? parsed.ver : ver,
            utc: typeof parsed.utc === 'number' ? parsed.utc : now(),
            region: typeof parsed.region === 'string' ? parsed.region : region,
          };
        } catch {
          /* corrupt — keep the implied default */
        }
      }
      emit();
      return state;
    },
    getState() {
      return state;
    },
    set(choices) {
      return commit(choices);
    },
    accept() {
      return commit({ preferences: true, statistics: true, marketing: true });
    },
    decline() {
      return commit({ preferences: false, statistics: false, marketing: false });
    },
    hasResponse() {
      return state.method === 'explicit';
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isConsented(category: ConsentCategory) {
      return gate.isConsented(category);
    },
    whenConsented(category, fn) {
      return gate.whenConsented(category, fn);
    },
    gate(category, fn) {
      return gate.gate(category, fn);
    },
  };
}

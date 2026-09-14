/**
 * Consent gating — the desktop equivalent of the web embed's prior-blocking. Instead of
 * rewriting <script> tags, you defer initializing an SDK until the relevant consent
 * category is granted:
 *
 *   gate.gate('statistics', () => initAnalytics());
 *
 * `initAnalytics` runs the moment consent for `statistics` is (or becomes) granted, and
 * never before — and never twice.
 */

import type { ConsentCategory, ConsentState } from './types.js';

/** Anything that exposes the current state and change notifications. */
export interface ConsentSource {
  getState(): ConsentState | Promise<ConsentState>;
  onChange(cb: (state: ConsentState) => void): () => void;
}

function granted(state: ConsentState, category: ConsentCategory): boolean {
  return category === 'necessary' ? true : state[category];
}

export interface ConsentGate {
  /** True iff the current state grants `category`. */
  isConsented(category: ConsentCategory): Promise<boolean>;
  /**
   * Run `fn` exactly once, as soon as `category` is granted — immediately if it already
   * is, otherwise on the first change that grants it. Returns an unsubscribe function
   * that cancels a still-pending gate.
   */
  whenConsented(category: ConsentCategory, fn: () => void): () => void;
  /**
   * Alias of {@link whenConsented} that reads as "gate this SDK behind consent":
   *   gate.gate('marketing', () => initMetaPixel());
   */
  gate(category: ConsentCategory, fn: () => void): () => void;
}

/** Build a {@link ConsentGate} over any {@link ConsentSource} (manager or renderer bridge). */
export function createConsentGate(source: ConsentSource): ConsentGate {
  const whenConsented: ConsentGate['whenConsented'] = (category, fn) => {
    let done = false;
    let unsub: (() => void) | null = null;

    const fire = () => {
      if (done) return;
      done = true;
      if (unsub) unsub();
      fn();
    };

    // Subscribe first so we never miss a change that lands between the read and the
    // subscription.
    unsub = source.onChange((state) => {
      if (granted(state, category)) fire();
    });

    Promise.resolve(source.getState()).then((state) => {
      if (granted(state, category)) fire();
    });

    return () => {
      done = true;
      if (unsub) unsub();
    };
  };

  return {
    async isConsented(category) {
      return granted(await source.getState(), category);
    },
    whenConsented,
    gate: whenConsented,
  };
}

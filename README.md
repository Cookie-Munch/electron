# @cookiemunch/electron

Cookie Munch SDK for **Electron** desktop apps. It gives a desktop app the same three
things the web embed gives a website:

1. **Consent capture** — an implied default until the user decides, then an explicit
   accept / decline / custom decision.
2. **An auditable ledger record** — every decision is POSTed to the Cookie Munch API
   (`POST /api/v1/consent`) so it lands in the tamper-evident, hash-chained consent log.
3. **Gating** — the desktop equivalent of prior-blocking: analytics/telemetry SDKs are
   initialized **only after** the relevant consent category is granted.

The decision is persisted **encrypted at rest** with Electron's OS-backed `safeStorage`
(with a plaintext-JSON fallback when encryption is unavailable), under the app's
`userData` directory.

The API mirrors [`@cookiemunch/react-native`](../react-native) so the mobile and desktop
SDKs feel identical (`Choices`, `ConsentState`, `ConsentMethod`, load/set/accept/decline,
`onChange`, pluggable storage).

## Install

```bash
pnpm add @cookiemunch/electron
```

`electron` is an **optional peer dependency**. This package builds and type-checks
without electron installed; you already have electron in a real app.

## Architecture

Electron has three contexts, and so does this SDK:

| Context   | What runs there                                                    |
| --------- | ----------------------------------------------------------------- |
| **Main**  | `createConsentManager(...)` (owns the decision + ledger) + `registerConsentIpc(...)` |
| **Preload** | `exposeConsentBridge(contextBridge, ipcRenderer)`               |
| **Renderer** | `getConsent()` / `setConsent()` / `onConsentChange()`, or `createConsentGate(bridgeConsentSource())` |

The manager lives in **main** because `safeStorage` and the network are only reliably
available there. The renderer talks to it over a context-isolated IPC bridge.

## Usage

### 1. Main process (`main.ts`)

```ts
import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import { createConsentManager, registerConsentIpc } from '@cookiemunch/electron';

const consent = createConsentManager({
  cbid: 'YOUR_SITE_ID',              // your Cookie Munch site id
  apiUrl: 'https://api.cookiemunch.net', // omit to disable ledger sync
  region: 'gb',
  // store defaults to electronSafeStore() (safeStorage-encrypted, userData dir)
});

app.whenReady().then(async () => {
  await consent.load(); // restore any prior decision

  // Expose get/set/accept/decline over IPC and push change events to all windows.
  registerConsentIpc(ipcMain, consent, {
    getWebContents: () => webContents.getAllWebContents(),
  });

  new BrowserWindow({
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      contextIsolation: true,
      sandbox: true,
    },
  }).loadFile('index.html');
});
```

### 2. Preload (`preload.ts`)

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeConsentBridge } from '@cookiemunch/electron';

// Exposes window.cookieMunchConsent = { get, set, accept, decline, onChange }
exposeConsentBridge(contextBridge, ipcRenderer);
```

### 3. Renderer (`renderer.ts`)

```ts
import {
  getConsent,
  setConsent,
  onConsentChange,
} from '@cookiemunch/electron';

// Show the current state
const state = await getConsent();
render(state);

// Wire up buttons
acceptBtn.onclick = () => setConsent({ preferences: true, statistics: true, marketing: true });
declineBtn.onclick = () => setConsent({ preferences: false, statistics: false, marketing: false });

// React to changes pushed from main
onConsentChange((state) => render(state));
```

## Gate your telemetry

Do **not** initialize an analytics/telemetry SDK at startup. Gate it behind consent, so
it only ever runs after the user opts in — the desktop equivalent of the web embed's
prior-blocking.

### In the main process

```ts
// Runs exactly once, the moment `statistics` consent is (or becomes) granted:
consent.gate('statistics', () => {
  const analytics = require('some-analytics-sdk');
  analytics.init({ appId: '…' });
});

consent.gate('marketing', () => initMarketingSdk());
```

### In the renderer

```ts
import { createConsentGate, bridgeConsentSource } from '@cookiemunch/electron';

const gate = createConsentGate(bridgeConsentSource());

gate.gate('statistics', () => {
  posthog.init('…'); // only after opt-in
});
```

`gate(category, fn)` (and its alias `whenConsented`) runs `fn` immediately if consent is
already granted, otherwise on the first change that grants it — and never more than once.
It returns an unsubscribe function to cancel a still-pending gate.

## Reading the ledger

The full typed Developer API client is re-exported for desktop dashboards:

```ts
import { createCookieMunch } from '@cookiemunch/electron';

const cm = createCookieMunch({ apiKey: 'fck_…', baseUrl: 'https://api.cookiemunch.net' });
const stats = await cm.consent.stats('YOUR_SITE_ID');
```

## API

- `createConsentManager(options)` → `ConsentManager` — main-process owner of the
  decision. `load()`, `getState()`, `set(choices)`, `accept()`, `decline()`,
  `hasResponse()`, `onChange(cb)`, plus the gate methods `gate`/`whenConsented`/`isConsented`.
- `electronSafeStore(options?)` / `memoryStore()` — `SecureStore` implementations.
- `createConsentApiClient({ apiUrl, fetch? })` — the ledger POST client (injectable).
- `registerConsentIpc(ipcMain, manager, { getWebContents?, channels? })` → disposer.
- `exposeConsentBridge(contextBridge, ipcRenderer, { key?, channels? })` — preload.
- `getConsent` / `setConsent` / `onConsentChange` — renderer helpers (read
  `window.cookieMunchConsent`; override with `{ scope, key }`).
- `createConsentGate(source)` / `bridgeConsentSource()` — gating anywhere.

## Notes

- Offline-safe: a decision is always persisted locally first; a failed ledger POST is
  swallowed and never loses the decision.
- `electron` is never imported statically anywhere in this package; the objects you pass
  in (`ipcMain`, `contextBridge`, `ipcRenderer`, `webContents`) and the lazily-loaded
  `safeStorage`/`app` are duck-typed, so nothing here forces electron into your build
  graph.

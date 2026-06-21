# DEX Risk Scoring — Full Codebase Walkthrough

## What Is This?

A **Chrome Manifest V3 browser extension** that scans Solana token listings on [DexScreener](https://dexscreener.com) and scores each token for rug-pull risk using a combination of **on-chain security data** (from the [RugCheck API](https://api.rugcheck.xyz)) and **real-time trading metrics** (scraped from DexScreener's DOM). The extension injects interactive "🛡️ Check" buttons and colored risk badges directly into the page — no page refresh required.

**Tech stack:** TypeScript, Vite, `@crxjs/vite-plugin`, React (options page only), vanilla DOM (content script).

---

## 1. Project Structure at a Glance

```text
dex-risk-extension/
├── manifest.json                ← Chrome extension manifest (Manifest V3)
├── vite.config.ts               ← Build config (Vite + CRXJS plugin)
├── postbuild.js                 ← Post-build script to fix content script references
├── index.html                   ← Vite dev server entry (unused at extension runtime)
├── options.html                 ← Extension popup / options page HTML shell
├── package.json                 ← Dependencies & build scripts
│
└── src/
    ├── types.ts                 ← ALL shared TypeScript types, interfaces, & defaults
    │
    ├── shared/                  ← Reusable utilities (no chrome.* API usage)
    │   ├── chainConfig.ts       ← Solana chain slug normalization
    │   └── formatters.ts        ← USD & time duration formatting helpers
    │
    ├── background/              ← Service Worker (runs in isolated context, no DOM)
    │   ├── index.ts             ← Message router, caching layer, batch processor
    │   ├── riskScorer.ts        ← Core risk scoring engine v7 ("the brain")
    │   └── rugcheckApi.ts       ← RugCheck API client & SecurityProfile builder
    │
    ├── content/                 ← Injected into DexScreener pages
    │   ├── index.iife.tsx       ← Orchestrator: init, observers, injection loops
    │   ├── domParser.ts         ← Finds Solana token rows, extracts MINT addresses
    │   ├── metricsExtractor.ts  ← Scrapes trading data from table columns
    │   ├── styleInjector.ts     ← Shadow DOM host & CSS injection
    │   ├── uiElements.ts        ← Notification banners & floating refresh button
    │   ├── messaging.ts         ← chrome.runtime.sendMessage with retry/backoff
    │   ├── badge.css            ← All badge, tooltip, button, & animation styles
    │   └── components/
    │       └── Badge.ts         ← Vanilla DOM badge/button element factories
    │
    └── options/                 ← Settings UI (React application)
        ├── index.tsx            ← React mount point
        ├── OptionsApp.tsx       ← Settings panel with per-category risk toggles
        ├── options.css          ← Options page dark-mode stylesheet
        └── chromeMock.ts        ← Fake chrome.storage for Vite dev mode
```

---

## 2. The Extension Manifest — `manifest.json`

The manifest is the **entry point of any Chrome extension**. It declares permissions, scripts, and UI surfaces.

```json
{
  "manifest_version": 3,
  "name": "Solana DEX Risk Scanner",
  "version": "3.0.0",
  "permissions": ["storage", "activeTab", "tabs"],
  "host_permissions": [
    "*://*.dexscreener.com/*",
    "https://api.rugcheck.xyz/*"
  ],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["*://*.dexscreener.com/*"],
    "js": ["src/content/index.iife.tsx"],
    "run_at": "document_idle"
  }],
  "action": { "default_popup": "options.html" }
}
```

### Permissions breakdown

| Permission | Why it's needed |
|---|---|
| `storage` | Persists user settings (enabled/disabled, risk check toggles) via `chrome.storage.sync` across devices. |
| `activeTab` | Grants temporary access to the current tab when the user clicks the extension icon. |
| `tabs` | Allows reading `tab.url` and `tab.title` — required for tab-level context. |
| `host_permissions: dexscreener.com` | Allows the content script to be injected on DexScreener pages and DOM access. |
| `host_permissions: api.rugcheck.xyz` | Allows the background service worker to make `fetch()` calls to the RugCheck API (would otherwise be blocked by CORS). |

### Key manifest fields

| Field | Meaning |
|---|---|
| `manifest_version: 3` | Manifest V3 — the latest Chrome extension API. Service workers replace persistent background pages; `chrome.action` replaces `chrome.browserAction`. |
| `background.service_worker` | The background script runs as an ephemeral service worker — Chrome can kill it after ~30s of inactivity. It wakes on message events. |
| `background.type: "module"` | Allows `import/export` syntax in the service worker. |
| `content_scripts[0].run_at: "document_idle"` | Injects the content script after the DOM is fully parsed and the page is idle — ensures DexScreener's table rows exist. |
| `action.default_popup` | Clicking the extension toolbar icon opens `options.html` as a popup. |

---

## 3. Build System

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
});
```

The `@crxjs/vite-plugin` reads `manifest.json` and:
1. **Resolves TypeScript entry points** — `src/background/index.ts` and `src/content/index.iife.tsx` are TS/TSX files, not raw JS. CRXJS tells Vite to compile them.
2. **Bundles each context separately** — content scripts, service worker, and options page each get their own bundle with no shared chunks leaking between contexts.
3. **Outputs the content script as an IIFE** — Manifest V3 content scripts run as classic scripts (not ES modules), so the output must be a self-contained `(function(){...})()` with no `import` statements.
4. **Generates `/dist`** — a correctly structured folder you can load as an unpacked extension via `chrome://extensions`.

### `postbuild.js`

A post-build fixup script that runs after `vite build`. CRXJS sometimes generates a "loader" script that dynamically imports the real content script via `chrome.runtime.getURL()`. The `postbuild.js` ensures the manifest correctly references whichever file CRXJS generates (loader or direct IIFE).

**Build command:** `npm run build` → runs `tsc -b && vite build && node postbuild.js`

### `package.json`

Key dependencies:
- **`react` / `react-dom`**: Used only for the options/settings page — NOT in the content script.
- **`@crxjs/vite-plugin`**: Chrome extension Vite integration.
- **`@types/chrome`**: TypeScript types for all `chrome.*` APIs.
- **`vite`**: Build tool and dev server.

---

## 4. Shared Type System — `src/types.ts`

This is the **single source of truth** for every TypeScript interface in the project. Every module imports from here — no ad-hoc type definitions scattered across files.

### RugCheck API types

| Type | Purpose |
|---|---|
| `RugCheckRisk` | A single risk flag from RugCheck: `{ name, value, description, score, level }`. The `level` field is `'warn'`, `'danger'`, `'info'`, or `'good'`. |
| `RugCheckSummary` | The lightweight `/report/summary` endpoint response: `risks[]`, `score`, `score_normalised` (0-100+, lower = safer), `lpLockedPct`. |
| `RugCheckReport` | The full `/report` endpoint response: top holders, token authorities (`mintAuthority`, `freezeAuthority`), `tokenMeta` (name, symbol, mutability), `transferFee`, `rugged` flag, `graphInsidersDetected`, and more. |

### DexScreener types

| Type | Purpose |
|---|---|
| `TradingMetrics` | Structured data scraped from a DexScreener table row: `marketCapUSD`, `ageMinutes`, `buys`, `sells`, `volumeUSD`, `traders`, `priceChange5m/1h/6h/24h`, `liquidityUSD`. |

### Risk assessment types

| Type | Purpose |
|---|---|
| `SecurityProfile` | On-chain security attributes built from RugCheck data: `mintAuthorityRevoked`, `freezeAuthorityRevoked`, `metadataImmutable`, `lpLockedPct`, `topHolderConcentration`, `insidersDetected`, `hasTransferFee`, `isRugged`, `rugCheckScore`, `rugCheckRisks[]`. |
| `RiskLevel` | `'low' | 'medium' | 'high' | 'critical' | 'unknown' | 'error'` |
| `ConfidenceLevel` | `'very_low' | 'low' | 'moderate' | 'high'` — how much data was available. |
| `RiskScore` | The final output: `address`, `riskScore` (0-100), `riskLevel`, `confidence`, `description`, `securityBreakdown`, `tradingBreakdown`. |

### User settings types

| Type | Purpose |
|---|---|
| `RiskCheckConfig` | Per-category configuration with `enabled` toggle, sub-check toggles, and `weight` (1=low, 2=normal, 3=high). Categories: `liquidity`, `smartContract`, `honeypot`, `holderDistribution`, `tradingPatterns`, `tokenAge`, `rugcheckFlags`. |
| `UserSettings` | Top-level settings: `enabled`, `showBadgesOnAllTokens`, `riskChecks: RiskCheckConfig`. |
| `DEFAULT_RISK_CHECKS` / `DEFAULT_SETTINGS` | Exported constants with sensible defaults. |

### Messaging types

| Type | Purpose |
|---|---|
| `MessageRequest` | `{ action: 'GET_RISK_SCORES', payload: { tokens: [{address, metrics}] } }` |
| `MessageResponse` | `{ success: boolean, data?: ScoreResponse, error?: string }` |

---

## 5. Shared Utilities — `src/shared/`

### `chainConfig.ts` — Chain Slug Normalization

DexScreener uses URL slugs like `/solana/...` or `/sol/...` for the same chain. This module:
- Maps all known Solana slugs (`'sol'`, `'solana'`) to the canonical `'solana'` identifier
- Exports `isSolana(slug)` — used by `domParser.ts` to filter out non-Solana rows
- Exports `normalizeChainSlug(slug)` — case-insensitive normalization

### `formatters.ts` — Human-Readable Formatting

Two utility functions used by the risk scorer to build tooltip descriptions:

| Function | Example | Output |
|---|---|---|
| `fmtUSD(1500000)` | Market cap display | `"$1.5M"` |
| `fmtUSD(38000)` | Liquidity display | `"$38.0K"` |
| `fmtAge(90)` | Token age | `"1.5h"` |
| `fmtAge(2880)` | Token age | `"2.0d"` |

---

## 6. Background Service Worker — `src/background/`

The background layer runs in an **isolated context** with no DOM access. It handles API calls to RugCheck and runs the scoring algorithm. Chrome can terminate it after ~30s of inactivity — it wakes up when a message arrives from the content script.

### `index.ts` — Message Router & Cache

**What it does:**
1. **Listens** for `GET_RISK_SCORES` messages from the content script
2. **Loads** the user's risk check configuration from `chrome.storage.sync`
3. **Checks** an in-memory cache (5-minute TTL) for previously scored tokens
4. **Fetches** on-chain security data via `buildSecurityProfile()` for uncached tokens
5. **Runs** the scoring algorithm via `scoreToken()`
6. **Builds** human-readable descriptions by joining security + trading reasons
7. **Caches** results and sends them back to the content script

**Batch processing:** Tokens are processed in batches of 5 concurrently to avoid hammering the RugCheck API.

**Cache invalidation:** When the user changes their risk check settings (`chrome.storage.onChanged`), the entire cache is cleared so new config applies immediately.

**Key design note:** The `return true` in `onMessage.addListener` keeps the message channel open for the async response — without this, Chrome closes the channel before the API calls finish.

### `rugcheckApi.ts` — RugCheck API Client

Interfaces with two RugCheck endpoints (no API key required):

| Endpoint | Function | Returns |
|---|---|---|
| `GET /v1/tokens/{mint}/report/summary` | `fetchRugCheckSummary()` | `RugCheckSummary` — lightweight: risks, score, LP lock percentage |
| `GET /v1/tokens/{mint}/report` | `fetchRugCheckReport()` | `RugCheckReport` — full: top holders, authorities, transfer fees, insider detection |

**Both endpoints are called in parallel** via `Promise.all` to minimize latency.

**`buildSecurityProfile(mint)`** — The core function that:
1. Calls both endpoints concurrently
2. If both fail, returns **neutral defaults** (not worst-case — this prevents everything showing as "CRITICAL" when the API is down)
3. Extracts `mintAuthority`, `freezeAuthority`, `metadataImmutable` from the report
4. Calculates `topHolderConcentration` as the sum of the top 10 holders' percentage
5. Returns a `SecurityProfile` object ready for the scorer

**Error handling:** Each endpoint has its own try/catch. A 200 OK with `{"error": "..."}` (which RugCheck returns for invalid pair addresses) is treated as null. The function degrades gracefully — if the summary works but the report fails, it uses whatever data is available.

### `riskScorer.ts` — The Risk Scoring Engine (v7)

This is the **brain** of the extension. It uses a 4-layer architecture:

#### Layer 1 — Normalized Signals

Raw data from `SecurityProfile` + `TradingMetrics` is transformed into a flat `NormalizedSignals` object. Each signal is computed **exactly once** — no category can double-count the same raw data.

Key signals:

| Signal | Source | Meaning |
|---|---|---|
| `mintEnabled` | RugCheck report | Token creator can mint more supply (dilution risk) |
| `freezeEnabled` | RugCheck report | Token creator can freeze wallets (honeypot risk) |
| `cantSell` | DexScreener metrics | buys > 50 AND sells === 0 AND age > 10min — high-confidence honeypot |
| `maybeCantSell` | DexScreener metrics | buys > 5 AND sells === 0 AND age ≤ 10min — might just be early launch |
| `liqMcapRatio` | DexScreener metrics | Liquidity / Market Cap — measures how easy it is to rug |
| `isBotPump` | DexScreener metrics | > 97% buys with > 20 transactions — bot-driven price pump |
| `isCoordinatedDump` | DexScreener metrics | > 97% sells with > 20 transactions — coordinated selling |
| `rugCheckClean` | RugCheck summary | RugCheck score ≤ 20 — externally validated as clean |
| `isLikelyPumpFun` | Derived | Mint active + RugCheck clean → likely a pump.fun bonding curve token (not malicious) |
| `volumeUSD` | DexScreener metrics | Trading volume — higher volume = harder to manipulate |
| `marketCapUSD` | DexScreener metrics | Market cap — larger tokens are harder to rug |

#### Layer 2 — Per-Category Risk Scoring

Seven independent scoring functions, each reading ONLY from normalized signals:

| Category | Function | Max Penalty | Key Logic |
|---|---|---|---|
| **Liquidity** | `scoreLiquidity()` | ~17 raw | Adaptive liq/mcap ratio (< 0.5% = paper-thin), raw liquidity < $500, LP unlock + mint active |
| **Smart Contract** | `scoreSmartContract()` | ~25 raw | Mint authority (+3 for pump.fun, +5 if RC clean, +15 otherwise), freeze authority (+2 if RC clean, +10 otherwise). **Pump.fun aware**: bonding curve tokens need mint authority to function. |
| **Honeypot** | `scoreHoneypot()` | ~35 raw | Can't sell detection (buys but zero sells), hidden transfer tax > 5% |
| **Holder Distribution** | `scoreHolders()` | ~15 raw | Whale concentration above threshold, insider network detection |
| **Trading Patterns** | `scoreTradingPatterns()` | ~24 raw | Price crash (> 70-90% in 1h), bot pumps, coordinated dumps, ghost tokens. **Positive bonuses**: balanced buy/sell ratio (-5), volume > $50K (-3 to -4), market cap > $100K (-2 to -4) |
| **Token Age** | `scoreTokenAge()` | ~4 raw | New tokens (< threshold age) get a small penalty. **Positive bonuses**: survived > 24h (-5), survived > 7d (-6) |
| **RugCheck Flags** | `scoreRugCheckFlags()` | ~41 raw | Confirmed rug (+35), danger flags (+2 each, capped at 3). **Trust bonuses**: RC score ≤ 5 (-10), ≤ 20 (-7), ≤ 40 (-3) |

Each score is multiplied by the user's weight setting: weight 1 = ×0.5, weight 2 = ×1.0, weight 3 = ×1.5.

#### Layer 3 — Confidence Engine

How much data do we actually have? Low data = low confidence = the "?" or "~" indicator on the badge.

| Data Source | Max Confidence Points |
|---|---|
| Token age > 24h | 30 |
| RugCheck API responded | 15 |
| RugCheck report data (holders, insiders) | 15 |
| Transaction count > 100 | 25 |
| Liquidity > $10K | 15 |

Confidence levels: **high** (≥ 70), **moderate** (≥ 45), **low** (≥ 25), **very_low** (< 25).

#### Layer 4 — Risk Level Classification

| Score Range | Risk Level | Badge |
|---|---|---|
| 0 – 20 | `low` | ✅ SAFE |
| 21 – 44 | `medium` | ⚠️ CAUTION |
| 45 – 64 | `high` | 🚩 HIGH |
| 65 – 100 | `critical` | ☠️ SCAM |

---

## 7. Content Script — `src/content/`

This layer runs **inside DexScreener's page context**. It has full DOM access but cannot make cross-origin API calls (that's why the background service worker exists). The content script is built as a self-contained **IIFE** (Immediately Invoked Function Expression) — no ES module imports.

### `index.iife.tsx` — The Orchestrator

The main entry point. It coordinates all content script modules.

**Initialization flow:**
1. Waits for DOM ready (`document.readyState` check)
2. Loads user settings from `chrome.storage.sync`
3. If extension is disabled, exits early
4. Calls `ensureShadowStyles()` to inject CSS
5. Sets up `listenForSettingsChanges()` for live updates
6. Calls `injectCheckButtons()` for initial row scan
7. Sets up **three** detection mechanisms for new rows:
   - **`setupMutationObserver()`** — primary: watches for DOM additions (new rows from virtual scroll)
   - **`setupScrollListener()`** — backup: 500ms debounced scroll handler for cases where MutationObserver doesn't fire
   - **`setupIntervalPoll()`** — fallback: polls every 3 seconds to catch any edge cases

**On-demand scanning model:**
- The extension does NOT auto-scan every token — it injects a "🛡️ Check" button on each Solana token row
- When the user clicks "Check", only THAT token gets scanned via RugCheck API
- Results are cached in a `Map<string, RiskScore>` so re-injections on scroll are instant

**`scanSingleToken(address, metrics, target)`:**
1. Replaces the "Check" button with a loading spinner badge
2. Sends a `GET_RISK_SCORES` message to the background service worker
3. On success: replaces the spinner with a colored risk badge
4. On failure: replaces the spinner with an "Error" badge

### `domParser.ts` — Token Row Detection & Address Extraction

**The most critical content script module** — if this breaks, nothing works.

**What it does:**
1. Queries the DOM for DexScreener table rows using multiple CSS selectors:
   ```
   a.ds-dex-table-row, a[class*="dex-table-row"], tr[class*="dex-table-row"]
   ```
2. Extracts the **chain slug** and **pair address** from the row's `href`:
   ```
   /solana/AbcDef123456...   →  chain="solana", pairAddress="AbcDef123456..."
   ```
3. Filters to **only Solana tokens** via `isSolana(chain)`
4. Extracts the **real token MINT address** from the icon `<img>` tag URL:
   ```
   https://dd.dexscreener.com/ds-data/tokens/solana/<MINT_ADDRESS>.png
   ```
   This is critical because the URL contains the **pair address** (LP pair), but the RugCheck API needs the **token mint address**. They are different addresses.
5. Deduplicates by mint address (prevents double-scanning)
6. Returns an array of `TokenRow` objects with `element`, `address`, `pairAddress`, `symbol`, `chain`, and `metrics`

**`findInjectionTarget(row)`** — Finds the best DOM element inside a row to append a badge to (the token column cell).

**`getObserverTarget()`** — Returns the `<main>` element (or `document.body` fallback) to attach the MutationObserver to.

### `metricsExtractor.ts` — Trading Data Scraper

Parses raw text from DexScreener table columns into structured numbers.

**Number parsing functions:**

| Function | Input | Output |
|---|---|---|
| `parseDollarValue("$38K")` | Compact USD with suffix | `38000` |
| `parseDollarValue("$1.1M")` | Millions | `1100000` |
| `parseDollarValue("0.0₄3821")` | Subscript decimal notation | `0.00003821` |
| `parseAge("1h 1m")` | Multi-unit time string | `61` (minutes) |
| `parseAge("3mo")` | Months | `129600` (minutes) |
| `parsePercent("-5.33%")` | Percentage with sign | `-5.33` |
| `parseIntValue("1,021")` | Integer with commas | `1021` |

**`extractMetrics(row)`** — The main function:
1. Finds all column elements via `[class*="col"]` (or falls back to direct children)
2. Locates the MCAP column dynamically (first `$` column after the token column)
3. Reads remaining columns by offset from MCAP:
   ```
   MCAP | PRICE | AGE | BUYS | SELLS | VOLUME | TRADERS | 5M | 1H | 6H | 24H | LIQUIDITY
   +0     +1      +2    +3     +4      +5       +6       +7   +8   +9   +10    +11
   ```
4. Returns a `TradingMetrics` object (defaults to zeros if extraction fails)

### `styleInjector.ts` — CSS Injection

Handles injecting `badge.css` into the DexScreener page. Idempotent — safe to call multiple times.

**Dual injection strategy:**
1. **Shadow DOM host** — a hidden `<div id="drex-shadow-host">` with `display:none` creates a Shadow DOM and injects styles into it. This provides CSS isolation.
2. **Document `<head>`** — also injects a `<style id="drex-styles">` tag directly into the page's `<head>`. Since badges are appended to the real DOM (not inside the shadow root), they need styles in the real document too.

**CSS source:** Uses Vite's `?inline` import (`import badgeCss from './badge.css?inline'`) to bundle the CSS as a string at build time — no runtime file loading.

### `messaging.ts` — Background Communication

Wraps `chrome.runtime.sendMessage()` in a clean async interface with **exponential backoff retry**.

**Why retry is needed:** MV3 service workers are ephemeral. Chrome can terminate them after ~30s of inactivity. If the content script sends a message while the worker is sleeping, `chrome.runtime.lastError` fires with "Could not establish connection" — the retry logic catches this and waits for the worker to wake up.

**Retry config:**
- Max retries: 3
- Delay sequence: 1s → 2s → 4s (exponential backoff)
- Retries on both `chrome.runtime.lastError` and `response.success === false`

### `uiElements.ts` — Floating UI Elements

Two utility functions for user-facing feedback:

| Function | Creates |
|---|---|
| `showNotification(message, type)` | A temporary banner (fixed position, top-right, auto-removes after 4s). Used for "Settings updated" or error messages. |
| `createRefreshButton(onRescan)` | A floating "Re-scan Risks" button with an SVG refresh icon. Calls the provided callback when clicked. |

### `badge.css` — All Visual Styles

379 lines of carefully crafted CSS with every property marked `!important` to override DexScreener's own CSS resets.

**Key style groups:**
- **`.drex-check-btn`** — The purple-tinted "🛡️ Check" button (Solana-themed with `#9945ff` violet)
- **`.drex-badge`** — Base badge styles with risk-level color variants:
  - `--low`: green (`#4ade80`)
  - `--medium`: amber (`#fbbf24`)
  - `--high`: red with pulse animation (`#f87171`)
  - `--critical`: deep red with aggressive pulse + glow (`#fca5a5`)
  - `--loading`: indigo with spinner animation
  - `--error`: purple
- **`.drex-tooltip`** — Dark tooltip (`#0f172a` background) shown on badge hover, with score bar, confidence indicator, and security/trading breakdowns
- **`.drex-badge__confidence`** — Small circle indicator (? or ~) for low-confidence scores
- **Keyframe animations**: `drex-spin` (spinner), `drex-pulse` (high risk), `drex-pulse-critical` (critical risk), `drex-slide-in` (notification entry)

### `components/Badge.ts` — DOM Element Factories

Pure **vanilla DOM** functions — no React, no JSX, no virtual DOM. This keeps the content script lightweight (React would add ~40KB+ just for badge rendering).

| Function | Creates | When |
|---|---|---|
| `createCheckButton(address, onClick)` | "🛡️ Check" button | Default state for every Solana token row |
| `createRiskBadge(score)` | Colored risk badge with tooltip | After successful scan |
| `createLoadingBadge(address)` | "Scanning…" badge with spinner | During API call |
| `createErrorBadge(address)` | "Error" badge | When API call fails |

**`createRiskBadge(score)`** internals:
1. Creates the outer `<span>` with risk-level class
2. Adds a colored dot indicator
3. Adds label text (✅ SAFE / ⚠️ CAUTION / 🚩 HIGH / ☠️ SCAM)
4. If confidence is low/very_low, adds a "?" or "~" indicator
5. Appends a rich tooltip with: header, score bar, confidence level, security breakdown, trading breakdown, and data source attribution

All elements use `data-drex-address` dataset attributes for lookup and deduplication.

---

## 8. Options UI — `src/options/`

### `index.tsx` — React Mount Point

A minimal entry point that renders `<OptionsApp />` into the `#root` element in `options.html`.

### `OptionsApp.tsx` — Settings Panel

A full React application with dark-mode UI providing granular control over the risk scoring algorithm.

**Settings sections:**

| Section | Controls | Storage Keys |
|---|---|---|
| Extension Toggle | Enable/disable the entire extension | `enabled` |
| Display Settings | Show badges on all tokens vs. on-demand | `showBadgesOnAllTokens` |
| Liquidity Checks | LP locked, low liquidity, liq/mcap ratio, weight | `riskChecks.liquidity.*` |
| Smart Contract Checks | Mint authority, freeze authority, transfer fees, weight | `riskChecks.smartContract.*` |
| Honeypot Checks | Can't sell, hidden tax, weight | `riskChecks.honeypot.*` |
| Holder Distribution | Whale concentration, insiders, threshold, weight | `riskChecks.holderDistribution.*` |
| Trading Patterns | Pump/dump, bot activity, coordinated dump, weight | `riskChecks.tradingPatterns.*` |
| Token Age | Very new check, age threshold (minutes), weight | `riskChecks.tokenAge.*` |
| RugCheck Flags | Trust RC score, weight | `riskChecks.rugcheckFlags.*` |

**Save flow:**
1. User changes a setting → React state updates
2. User clicks "Save Settings" → `chrome.storage.sync.set(settings)` persists to sync storage
3. The content script's `listenForSettingsChanges()` fires automatically → live update
4. The background service worker's `chrome.storage.onChanged` listener clears the score cache → next scan uses new config

### `chromeMock.ts` — Dev Mode Support

When running `npm run dev` (Vite dev server), `chrome.storage.sync` doesn't exist. This module provides a fake implementation backed by `localStorage` so the options page can be developed without loading the extension into Chrome.

### `options.css` — Options Page Stylesheet

Dark-themed stylesheet matching DexScreener's aesthetic. Features glassmorphism cards, custom toggle switches, and responsive layout.

---

## 9. Key Design Decisions

| Decision | Rationale |
|---|---|
| **On-demand scanning (not auto-scan)** | Auto-scanning every visible token would hammer the RugCheck API with dozens of requests per scroll. On-demand scanning respects rate limits and gives users control. |
| **IIFE content script (not ES module)** | Manifest V3 content scripts run as classic scripts. ES module `import` statements throw `SyntaxError`. The Vite build produces a self-contained IIFE. |
| **Vanilla DOM for badges (not React)** | Content scripts should be < 20KB. React would add 40KB+ runtime for a few `<span>` elements. Vanilla DOM creation is faster and lighter. |
| **Three detection mechanisms** | DexScreener uses virtual scrolling — rows are created/destroyed as you scroll. MutationObserver is primary, scroll listener is backup, interval poll catches edge cases. |
| **Pump.fun-aware scoring** | Most Solana memecoin launches use pump.fun's bonding curve, which requires mint authority to be active. Penalizing this the same as a random token with active mint creates massive false positives. |
| **RugCheck as supporting evidence** | RugCheck provides valuable external validation, but it can miss scams or lag behind. The scorer uses it as a bonus/penalty modifier, not as truth. |
| **Neutral defaults when API fails** | If RugCheck is down, defaulting to worst-case causes everything to show as CRITICAL. Neutral defaults (score 50, authorities revoked, no flags) prevent panic. |
| **Content script `scoreCache`** | DexScreener virtualizes lists (rows are unmounted/remounted on scroll). The local Map cache prevents re-scanning and loading spinner flicker. |
| **Separate `domParser` + `metricsExtractor`** | When DexScreener changes their DOM structure (which happens frequently), only one specific module needs updating — the rest of the pipeline is unaffected. |
| **Exponential backoff in messaging** | MV3 service workers can be killed by Chrome at any time. The retry logic with 1s → 2s → 4s backoff ensures messages get through even when the worker needs to restart. |
| **Per-category weights** | Users have different risk tolerances. A DeFi dev might not care about mint authority (weight=1), while a retail trader might set it to maximum (weight=3). |
| **Dual CSS injection (Shadow DOM + head)** | Shadow DOM provides isolation for future use; head injection ensures real-DOM badges are styled. Both are needed because badges live in the real DOM. |

---

## 10. Data Flow — End-to-End

```text
┌─────────────────────────────────────────────────────────────────────┐
│                          DexScreener Page                          │
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐   │
│  │  domParser.ts │ ──▶ │metricsExtr.ts│ ──▶ │ index.iife.tsx     │   │
│  │ Find rows,   │     │ Parse $, age,│     │ Inject "Check"    │   │
│  │ extract mint  │     │ buys, sells  │     │ buttons on rows   │   │
│  └──────────────┘     └──────────────┘     └────────┬──────────┘   │
│                                                      │              │
│                                              User clicks "Check"    │
│                                                      │              │
│  ┌──────────────┐                           ┌────────▼──────────┐   │
│  │  Badge.ts    │ ◀─── risk score ──────── │  messaging.ts     │   │
│  │ Show ✅/⚠️/🚩│                           │ sendMessage +     │   │
│  │ with tooltip  │                           │ retry backoff     │   │
│  └──────────────┘                           └────────┬──────────┘   │
└──────────────────────────────────────────────────────┼──────────────┘
                                                       │
                        chrome.runtime.sendMessage     │
                                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Background Service Worker                        │
│                                                                      │
│  ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐    │
│  │   index.ts   │ ──▶ │rugcheckApi.ts│ ──▶ │  riskScorer.ts    │    │
│  │ Route msg,   │     │ Fetch summary│     │ v7 scoring engine │    │
│  │ check cache  │     │ + full report│     │ Pump.fun aware    │    │
│  └──────────────┘     └──────────────┘     └───────────────────┘    │
│                             │                        │               │
│                     api.rugcheck.xyz          Score 0-100 +          │
│                     (parallel fetch)          confidence +           │
│                                               reasons                │
└──────────────────────────────────────────────────────────────────────┘
```

/**
 * Content Script Entry Point — Solana Only (On-Demand Scanning)
 * --------------------------------------------------------------
 * Injects a small "🛡️ Check" button on each Solana token row.
 * When clicked, only THAT token gets scanned via RugCheck API.
 *
 * Handles DexScreener's virtual scrolling by combining:
 * 1. MutationObserver — catches DOM additions from virtual scroll
 * 2. Scroll listener — backup for cases where mutations aren't fired
 * 3. Interval poll — catches any edge cases every few seconds
 */

import type { RiskScore, UserSettings, TradingMetrics } from '../types';
import { createLoadingBadge, createRiskBadge, createErrorBadge, createCheckButton } from './components/Badge';
import { parseTokenRows, findInjectionTarget, getObserverTarget } from './domParser';
import { requestRiskScores } from './messaging';
import { ensureShadowStyles } from './styleInjector';

// ─── Local Defaults (Avoids code-splitting shared chunks with settings page) ───

const DEFAULT_RISK_CHECKS = {
  liquidity: {
    enabled: true,
    checkLpLocked: true,
    checkLowLiquidity: true,
    checkLiqMcapRatio: true,
    weight: 2,
  },
  smartContract: {
    enabled: true,
    checkMintAuthority: true,
    checkFreezeAuthority: true,
    checkTransferFees: true,
    weight: 3,
  },
  honeypot: {
    enabled: true,
    checkCantSell: true,
    checkHiddenTax: true,
    weight: 3,
  },
  holderDistribution: {
    enabled: true,
    checkWhaleConcentration: true,
    checkInsiders: true,
    whaleThreshold: 50,
    weight: 2,
  },
  tradingPatterns: {
    enabled: true,
    checkPumpDump: true,
    checkBotActivity: true,
    checkCoordinatedDump: true,
    weight: 2,
  },
  tokenAge: {
    enabled: true,
    checkVeryNew: true,
    newTokenMinutes: 60,
    weight: 1,
  },
  rugcheckFlags: {
    enabled: true,
    trustRugCheckScore: true,
    weight: 2,
  },
} as const;

const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  showBadgesOnAllTokens: true,
  riskChecks: DEFAULT_RISK_CHECKS as any,
};

// ─── State ──────────────────────────────────────────────────────

let settings: UserSettings = { ...DEFAULT_SETTINGS };

// Cache scored tokens so re-injections on scroll are instant
const scoreCache = new Map<string, RiskScore>();

// ─── Scan a Single Token ────────────────────────────────────────

async function scanSingleToken(address: string, metrics: TradingMetrics, target: HTMLElement) {
  // Replace the check button with a loading badge
  const existing = target.querySelector(`[data-drex-address="${address}"]`);
  if (existing) {
    existing.replaceWith(createLoadingBadge(address));
  }

  try {
    const response = await requestRiskScores([{ address, metrics }]);
    const score = response.scores[0];

    if (score) {
      scoreCache.set(score.address, score);

      const loading = target.querySelector(`[data-drex-address="${address}"]`);
      if (loading) {
        loading.replaceWith(createRiskBadge(score));
      }
    }
  } catch (err) {
    console.error('[DEX Risk] Scan failed for', address, err);
    const loading = target.querySelector(`[data-drex-address="${address}"]`);
    if (loading) {
      loading.replaceWith(createErrorBadge(address));
    }
  }
}

// ─── Inject Check Buttons ───────────────────────────────────────

/**
 * Scans the DOM for Solana token rows and injects a "Check" button
 * on each one. Does NOT trigger any API calls — that only happens
 * when the user clicks the button.
 *
 * Safe to call repeatedly — checks for existing badges/buttons
 * before injecting new ones.
 */
function injectCheckButtons() {
  if (!settings.enabled) return;

  const tokenRows = parseTokenRows();
  if (tokenRows.length === 0) return;

  tokenRows.forEach(({ element, address, metrics }) => {
    const target = findInjectionTarget(element);

    // Already has a badge or button for this address — skip
    if (target.querySelector(`[data-drex-address="${address}"]`)) return;

    // If we have a cached score, show the result badge directly
    const cached = scoreCache.get(address);
    if (cached) {
      target.appendChild(createRiskBadge(cached));
      return;
    }

    // Inject the "Check" button
    const checkBtn = createCheckButton(address, () => {
      scanSingleToken(address, metrics, target);
    });
    target.appendChild(checkBtn);
  });
}

// ─── Debounced injection ────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedInject() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => injectCheckButtons(), 300);
}

// ─── Mutation Observer ──────────────────────────────────────────

function setupMutationObserver() {
  const observerTarget = getObserverTarget();
  const observer = new MutationObserver((mutations) => {
    const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
    if (!hasNewNodes) return;
    debouncedInject();
  });

  observer.observe(observerTarget, { childList: true, subtree: true });
}

// ─── Scroll Listener (backup for virtual scroll) ────────────────

function setupScrollListener() {
  // DexScreener uses virtual scrolling — new rows appear as you scroll
  // but might not always fire MutationObserver events. This scroll
  // listener acts as a backup.
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener('scroll', () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => injectCheckButtons(), 500);
  }, { passive: true });
}

// ─── Interval Poll (catches edge cases) ─────────────────────────

function setupIntervalPoll() {
  // Poll every 3 seconds to catch any rows that slipped through
  // the MutationObserver and scroll listener
  setInterval(() => injectCheckButtons(), 3000);
}

// ─── Settings Listener ──────────────────────────────────────────

function listenForSettingsChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    Object.keys(changes).forEach(key => {
      (settings as any)[key] = changes[key].newValue;
    });
    console.log('[DEX Risk] Settings updated:', settings);
  });
}

// ─── Initialization ─────────────────────────────────────────────

function init() {
  chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), async (stored) => {
    settings = { ...DEFAULT_SETTINGS, ...(stored || {}) as Partial<UserSettings> };

    if (!settings.enabled) {
      console.log('[DEX Risk] Extension disabled by user.');
      return;
    }

    ensureShadowStyles();
    listenForSettingsChanges();

    // Inject check buttons on all visible Solana token rows
    injectCheckButtons();
    
    // Set up three detection mechanisms for new rows:
    setupMutationObserver();  // primary: DOM changes
    setupScrollListener();    // backup: virtual scroll
    setupIntervalPoll();      // fallback: periodic check
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

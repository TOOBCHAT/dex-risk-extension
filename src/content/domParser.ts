/**
 * DOM Parser — Solana Only
 * -------------------------
 * Scans DexScreener's page for Solana token rows, extracts
 * the actual token MINT address (not the pair address), and
 * delegates metric extraction to metricsExtractor.
 *
 * IMPORTANT: The URL href contains the PAIR address, but the
 * RugCheck API needs the TOKEN MINT address. We extract the
 * mint address from the token icon URL, which follows this format:
 *   https://dd.dexscreener.com/ds-data/tokens/solana/<MINT_ADDRESS>.png
 */

import type { TradingMetrics } from '../types';
import { isSolana, normalizeChainSlug } from '../shared/chainConfig';
import { extractMetrics } from './metricsExtractor';

// ─── Types ──────────────────────────────────────────────────────

export interface TokenRow {
  element: HTMLElement;
  address: string;       // token MINT address (for RugCheck API)
  pairAddress: string;   // LP pair address (from URL)
  symbol: string;
  chain: string;
  metrics: TradingMetrics;
}

// ─── Selector Config ────────────────────────────────────────────

const SELECTORS = {
  ROW:       'a.ds-dex-table-row, a[class*="dex-table-row"], tr[class*="dex-table-row"]',
  CONTAINER: 'main',
  HREF_RE:   /^\/([a-z0-9_-]+)\/([a-zA-Z0-9]{10,})/i,
  TOKEN_COL: '.ds-dex-table-row-col-token, [class*="col-token"]',
  SYMBOL:    '.ds-dex-table-row-base-token-symbol, [class*="symbol"], [class*="Symbol"]',
} as const;

// ─── Token Mint Extraction ──────────────────────────────────────

/**
 * Regex to extract the token mint address from the DexScreener icon URL.
 * Pattern: https://dd.dexscreener.com/ds-data/tokens/solana/<MINT_ADDRESS>.png
 * Also handles CDN image URLs that contain the mint address.
 */
const ICON_MINT_RE = /\/ds-data\/tokens\/solana\/([a-zA-Z0-9]{20,50})\./i;

/**
 * Tries to extract the actual token mint address from the row's icon image.
 * Returns null if no mint address is found in any icon URL.
 */
function extractMintFromIcon(row: HTMLElement): string | null {
  // Look for token icon images within the row
  const imgs = row.querySelectorAll<HTMLImageElement>('img');
  for (const img of imgs) {
    const src = img.src || img.getAttribute('src') || '';
    const match = src.match(ICON_MINT_RE);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Scans the page and returns all detected Solana token rows.
 * Only includes rows where the chain slug is Solana (sol/solana).
 * 
 * Extracts the TOKEN MINT address from icon URLs, NOT the pair address
 * from the row's href. The pair address is kept as a separate field.
 */
export function parseTokenRows(): TokenRow[] {
  const rows = document.querySelectorAll<HTMLElement>(SELECTORS.ROW);
  const seen = new Set<string>();
  const results: TokenRow[] = [];

  rows.forEach(el => {

    const href = el.getAttribute('href') || '';
    const match = href.match(SELECTORS.HREF_RE);
    if (!match) return;

    const chain       = normalizeChainSlug(match[1]);
    const pairAddress = match[2];

    // ONLY Solana tokens
    if (!isSolana(chain)) return;

    // Minimum address length (Solana addresses are 32-44 chars)
    if (pairAddress.length < 10) return;

    // Try to extract the REAL token mint address from the icon URL
    const mintAddress = extractMintFromIcon(el);
    
    // Use the mint address if found, otherwise fall back to pair address
    // (pair address will fail RugCheck, but better than skipping the token)
    const address = mintAddress || pairAddress;

    // Deduplication — by mint address
    if (seen.has(address)) return;
    seen.add(address);

    const symbolEl = el.querySelector(SELECTORS.SYMBOL);
    const symbol   = symbolEl?.textContent?.trim() || address.slice(0, 6) + '…';
    const metrics  = extractMetrics(el);

    results.push({ element: el, address, pairAddress, symbol, chain, metrics });
  });

  return results;
}

/** Finds the best injection point inside a row for a badge. */
export function findInjectionTarget(row: HTMLElement): HTMLElement {
  return row.querySelector<HTMLElement>(SELECTORS.TOKEN_COL) ?? row;
}

/** Returns the container element to attach the MutationObserver to. */
export function getObserverTarget(): Element {
  return document.querySelector(SELECTORS.CONTAINER) ?? document.body;
}

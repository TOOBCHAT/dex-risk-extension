/**
 * Metrics Extractor
 * -----------------
 * Parses raw text values from DexScreener table columns into
 * structured TradingMetrics. Contains all number-parsing logic
 * (dollar values, ages, percentages, integers).
 */

import type { TradingMetrics } from '../types';

// ─── Number Parsing ─────────────────────────────────────────────

const DOLLAR_MULTIPLIERS: Record<string, number> = {
  K: 1_000, k: 1_000,
  M: 1_000_000, m: 1_000_000,
  B: 1_000_000_000, b: 1_000_000_000,
  T: 1_000_000_000_000, t: 1_000_000_000_000,
};

/** Returns true if a string represents "no data". */
function isEmpty(text: string): boolean {
  const t = text.trim();
  return t === '' || t === '-' || t === '—';
}

/**
 * Parses compact dollar values from DexScreener.
 * "$38K" → 38000, "$1.1M" → 1100000, "$55.05" → 55.05
 */
export function parseDollarValue(text: string): number {
  if (!text) return 0;
  const clean = text.replace(/[$,\s]/g, '').trim();
  if (isEmpty(clean)) return 0;

  // Standard number with optional suffix: "38K", "1.1M"
  const match = clean.match(/^([0-9.]+)([KkMmBbTt])?$/);
  if (match) {
    const num = parseFloat(match[1]);
    const mult = match[2] ? (DOLLAR_MULTIPLIERS[match[2]] || 1) : 1;
    return isNaN(num) ? 0 : num * mult;
  }

  // DexScreener subscript notation: "0.0₄3821" (subscript = zero count)
  const subMatch = clean.match(/^([0-9]*\.?0*)[₀₁₂₃₄₅₆₇₈₉]+([0-9]+)$/);
  if (subMatch) {
    return parseFloat(clean.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, '0')) || 0;
  }

  const result = parseFloat(clean);
  return isNaN(result) ? 0 : result;
}

/**
 * Parses age strings into total minutes.
 * "4m" → 4, "1h 1m" → 61, "2d" → 2880, "3mo" → 129600
 */
export function parseAge(text: string): number {
  if (!text) return 0;
  const clean = text.trim();
  if (isEmpty(clean)) return 0;

  let totalMinutes = 0;
  const moMatch = clean.match(/(\d+)\s*mo/);   // months
  const dayMatch = clean.match(/(\d+)\s*d/);    // days
  const hourMatch = clean.match(/(\d+)\s*h/);   // hours
  const minMatch = clean.match(/(\d+)\s*m(?!o)/); // minutes (not months)

  if (moMatch) totalMinutes += parseInt(moMatch[1]) * 43200;  // ~30 days
  if (dayMatch) totalMinutes += parseInt(dayMatch[1]) * 1440;
  if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
  if (minMatch) totalMinutes += parseInt(minMatch[1]);

  return totalMinutes || 0;
}

/**
 * Parses percentage strings.
 * "7.21%" → 7.21, "-5.33%" → -5.33, "-" → 0
 */
export function parsePercent(text: string): number {
  if (!text) return 0;
  const clean = text.replace(/[%,\s]/g, '').trim();
  if (isEmpty(clean)) return 0;
  const result = parseFloat(clean);
  return isNaN(result) ? 0 : result;
}

/**
 * Parses plain integer strings.
 * "186" → 186, "1,021" → 1021, "-" → 0
 */
export function parseIntValue(text: string): number {
  if (!text) return 0;
  const clean = text.replace(/[,\s]/g, '').trim();
  if (isEmpty(clean)) return 0;
  const result = parseInt(clean, 10);
  return isNaN(result) ? 0 : result;
}

// ─── Column Extraction ──────────────────────────────────────────

/** Default metrics when extraction fails. */
const EMPTY_METRICS: TradingMetrics = {
  marketCapUSD: 0, ageMinutes: 0, buys: 0, sells: 0,
  volumeUSD: 0, traders: 0, priceChange5m: 0, priceChange1h: 0,
  priceChange6h: 0, priceChange24h: 0, liquidityUSD: 0,
};

/**
 * Extracts trading metrics from a DexScreener table row.
 *
 * Expected column order (from the header):
 *   TOKEN | MCAP | PRICE | AGE | BUYS | SELLS | VOLUME | TRADERS | 5M | 1H | 6H | 24H | LIQUIDITY
 *
 * We find the MCAP column dynamically (first $ column after token)
 * and read remaining columns by offset.
 */
export function extractMetrics(row: HTMLElement): TradingMetrics {
  // Try class-based column selection first, then fall back to children
  let cols = Array.from(row.querySelectorAll<HTMLElement>('[class*="col"]'));
  if (cols.length < 5) {
    cols = Array.from(row.children).filter(
      el => el instanceof HTMLElement
    ) as HTMLElement[];
  }

  const texts = cols.map(c => c.textContent?.trim() || '');
  if (texts.length < 5) return { ...EMPTY_METRICS };

  // Locate MCAP: first column after token (index 0) that starts with '$'
  let mcapIdx = -1;
  for (let i = 1; i < texts.length; i++) {
    if (texts[i].startsWith('$') && texts[i].match(/\d/)) {
      mcapIdx = i;
      break;
    }
  }
  if (mcapIdx === -1) mcapIdx = 1; // fallback to position 1

  const at = (offset: number) => texts[mcapIdx + offset] || '';

  return {
    marketCapUSD:   parseDollarValue(at(0)),
    ageMinutes:     parseAge(at(2)),
    buys:           parseIntValue(at(3)),
    sells:          parseIntValue(at(4)),
    volumeUSD:      parseDollarValue(at(5)),
    traders:        parseIntValue(at(6)),
    priceChange5m:  parsePercent(at(7)),
    priceChange1h:  parsePercent(at(8)),
    priceChange6h:  parsePercent(at(9)),
    priceChange24h: parsePercent(at(10)),
    liquidityUSD:   parseDollarValue(at(11)),
  };
}

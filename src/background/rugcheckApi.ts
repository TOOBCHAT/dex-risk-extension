/**
 * RugCheck API Client
 * -------------------
 * Fetches on-chain security data from api.rugcheck.xyz.
 * This is the same data source that @soul_scanner_bot uses:
 *   - Mint authority status
 *   - Freeze authority status
 *   - LP lock percentage
 *   - Top holder concentration
 *   - Insider detection
 *   - Known risk flags
 *
 * No API key required for the public endpoints.
 */

import type { RugCheckSummary, RugCheckReport, SecurityProfile } from '../types';

const API_BASE = 'https://api.rugcheck.xyz/v1';

// ─── API Fetchers ───────────────────────────────────────────────

/**
 * Fetches the lightweight summary report for a token.
 * Contains: risks[], score, score_normalised, lpLockedPct
 */
export async function fetchRugCheckSummary(mint: string): Promise<RugCheckSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/tokens/${mint}/report/summary`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[DEX Risk] RugCheck summary failed for ${mint}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data.error || data.score_normalised === undefined) {
      console.warn(`[DEX Risk] RugCheck summary error response for ${mint}:`, data.error || 'missing score');
      return null;
    }
    return data as RugCheckSummary;
  } catch (err) {
    console.error(`[DEX Risk] RugCheck summary error for ${mint}:`, err);
    return null;
  }
}

/**
 * Fetches the full detailed report for a token.
 * Contains: topHolders, markets, lockers, token authorities, etc.
 * 
 * NOTE: This response can be very large (400KB+ for popular tokens).
 * We extract only the fields we need and discard the rest.
 */
export async function fetchRugCheckReport(mint: string): Promise<RugCheckReport | null> {
  try {
    const res = await fetch(`${API_BASE}/tokens/${mint}/report`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[DEX Risk] RugCheck report failed for ${mint}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    // RugCheck returns {"error": "..."} for invalid/pair addresses (still 200 OK)
    if (data.error || !data.mint) {
      console.warn(`[DEX Risk] RugCheck report error response for ${mint}:`, data.error || 'missing mint field');
      return null;
    }
    return data as RugCheckReport;
  } catch (err) {
    console.error(`[DEX Risk] RugCheck report error for ${mint}:`, err);
    return null;
  }
}

// ─── Security Profile Builder ───────────────────────────────────

/**
 * Builds a SecurityProfile from RugCheck data.
 * Uses summary for speed; falls back to defaults if API fails.
 */
export async function buildSecurityProfile(mint: string): Promise<SecurityProfile> {
  // Fetch both in parallel — summary is fast, report gives us holder data
  const [summary, report] = await Promise.all([
    fetchRugCheckSummary(mint),
    fetchRugCheckReport(mint),
  ]);

  // Defaults when API fails: assume NEUTRAL, not worst-case.
  // Scoring the token as worst-case when the API is just slow/down
  // is what caused everything to show as "CRITICAL".
  const defaults: SecurityProfile = {
    mintAuthorityRevoked: true,   // assume revoked (neutral)
    freezeAuthorityRevoked: true, // assume revoked (neutral)
    metadataImmutable: true,      // assume immutable (neutral)
    lpLockedPct: 100,             // not penalized anyway
    topHolderConcentration: 0,    // assume dispersed (neutral)
    insidersDetected: 0,
    hasTransferFee: false,
    transferFeePct: 0,
    isRugged: false,
    rugCheckScore: 50,            // middle of the road
    rugCheckRisks: [],
  };

  if (!summary && !report) return defaults;

  // ── From summary ──
  const lpLockedPct = summary?.lpLockedPct ?? 0;
  // score_normalised: 0-100+ scale where LOWER = SAFER
  // USDC=1, clean pump.fun token=16, risky=53
  const rugCheckScore = summary?.score_normalised ?? report?.score_normalised ?? 50;
  const risks = summary?.risks ?? report?.risks ?? [];

  // ── From full report ──
  const mintAuth = report?.mintAuthority ?? report?.token?.mintAuthority;
  const freezeAuth = report?.freezeAuthority ?? report?.token?.freezeAuthority;
  const mutable = report?.tokenMeta?.mutable ?? true;

  // Calculate top 10 holder concentration (safely handle null/undefined)
  let topHolderConcentration = 0;
  const holders = report?.topHolders;
  if (Array.isArray(holders) && holders.length > 0) {
    const top10 = holders.slice(0, 10);
    topHolderConcentration = top10.reduce((sum, h) => sum + (h.pct || 0), 0);
  }

  return {
    mintAuthorityRevoked: mintAuth === null || mintAuth === undefined,
    freezeAuthorityRevoked: freezeAuth === null || freezeAuth === undefined,
    metadataImmutable: !mutable,
    lpLockedPct: Math.min(100, Math.max(0, lpLockedPct)),
    topHolderConcentration: Math.min(100, Math.max(0, topHolderConcentration)),
    insidersDetected: report?.graphInsidersDetected ?? 0,
    hasTransferFee: (report?.transferFee?.pct ?? 0) > 0,
    transferFeePct: report?.transferFee?.pct ?? 0,
    isRugged: report?.rugged ?? false,
    rugCheckScore,
    rugCheckRisks: Array.isArray(risks) ? risks : [],
  };
}

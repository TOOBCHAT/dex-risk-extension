/**
 * Background Service Worker — Solana-Only
 * ----------------------------------------
 * Routes scoring requests from the content script.
 * Fetches security data from RugCheck API, then combines
 * it with DexScreener trading metrics for final scoring.
 * 
 * Loads user-configured risk check preferences from storage
 * and passes them to the scoring algorithm.
 */

import type { TradingMetrics, RiskScore, RiskCheckConfig, UserSettings } from '../types';
import { DEFAULT_RISK_CHECKS } from '../types';
import { buildSecurityProfile } from './rugcheckApi';
import { scoreToken, type ScoredResult } from './riskScorer';

// ─── Types ──────────────────────────────────────────────────────

interface TokenPayload {
  address: string;
  metrics: TradingMetrics;
}

// ─── Cache ──────────────────────────────────────────────────────

const riskCache: Record<string, ScoredResult> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cacheTimes: Record<string, number> = {};

function isCacheValid(address: string): boolean {
  const time = cacheTimes[address];
  if (!time) return false;
  return (Date.now() - time) < CACHE_TTL_MS;
}

// ─── Load Risk Check Config ─────────────────────────────────────

async function loadRiskCheckConfig(): Promise<RiskCheckConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('riskChecks', (stored) => {
      const config = (stored?.riskChecks as RiskCheckConfig) || DEFAULT_RISK_CHECKS;
      resolve(config);
    });
  });
}

// ─── Score a single token ───────────────────────────────────────

async function scoreOneToken(
  address: string,
  metrics: TradingMetrics,
  config: RiskCheckConfig,
): Promise<ScoredResult> {
  // Check cache first
  if (riskCache[address] && isCacheValid(address)) {
    return riskCache[address];
  }

  // Fetch on-chain security data from RugCheck
  const securityProfile = await buildSecurityProfile(address);

  // Run the scoring algorithm with user's config
  const scored = scoreToken(securityProfile, metrics, config);

  // Build human-readable descriptions
  const allReasons = [...scored.securityReasons, ...scored.tradingReasons];

  const result: ScoredResult = {
    address,
    riskScore: scored.riskScore,
    riskLevel: scored.riskLevel,
    confidence: scored.confidence,
    confidenceLevel: scored.confidenceLevel,
    description: allReasons.length > 0
      ? allReasons.join(' · ')
      : 'No risk signals detected with current checks',
    securityBreakdown: scored.securityReasons.join(' · ') || 'No security issues found',
    tradingBreakdown: scored.tradingReasons.join(' · ') || 'No trading concerns',
  };

  // Cache the result
  riskCache[address] = result;
  cacheTimes[address] = Date.now();

  return result;
}

// ─── Batch processing with concurrency limit ────────────────────

async function processTokenBatch(
  tokens: TokenPayload[],
  config: RiskCheckConfig,
): Promise<ScoredResult[]> {
  // Process in batches of 5 to avoid hammering RugCheck API
  const CONCURRENCY = 5;
  const results: ScoredResult[] = [];

  for (let i = 0; i < tokens.length; i += CONCURRENCY) {
    const batch = tokens.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(({ address, metrics }) => scoreOneToken(address, metrics, config))
    );
    results.push(...batchResults);
  }

  return results;
}

// ─── Message Handler ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== 'GET_RISK_SCORES') return;

  const { tokens } = request.payload as {
    tokens: TokenPayload[];
  };

  // Load user's risk config, then process
  loadRiskCheckConfig()
    .then(config => processTokenBatch(tokens, config))
    .then(results => {
      sendResponse({
        success: true,
        data: { scores: results as RiskScore[] },
      });
    })
    .catch(error => {
      console.error('[DEX Risk] Scoring error:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

  return true; // keep channel open for async response
});

// ─── Invalidate cache on settings change ────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.riskChecks) {
    // Clear cache so new config applies immediately
    Object.keys(riskCache).forEach(k => delete riskCache[k]);
    Object.keys(cacheTimes).forEach(k => delete cacheTimes[k]);
    console.log('[DEX Risk] Risk check config changed — cache cleared');
  }
});

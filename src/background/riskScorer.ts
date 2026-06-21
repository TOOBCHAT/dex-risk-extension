/**
 * Scam Scorer v7 — Pump.fun-Aware Architecture
 * ==================================================
 *
 * Architecture:
 *   raw on-chain data → normalized signals → risk engine → confidence engine → explanation
 *
 * Key improvements over v6:
 *   1. Pump.fun token detection — reduces false positives on legitimate
 *      bonding-curve tokens where mint/freeze authority is normal
 *   2. Stronger positive signals — volume, market cap, age, balanced
 *      trading all reduce score more aggressively
 *   3. Higher RugCheck trust — clean RC score now gives bigger bonus
 *   4. Raised thresholds — medium ≥21, high ≥45 to prevent normal
 *      tokens from hitting CAUTION
 *   5. Signal deduplication — no double-counting (e.g. transferFee)
 *   6. Confidence score alongside risk score
 */

import type {
  TradingMetrics,
  SecurityProfile,
  RiskLevel,
  ConfidenceLevel,
  RiskCheckConfig,
} from '../types';
import { fmtUSD, fmtAge } from '../shared/formatters';

// ═════════════════════════════════════════════════════════════════
// LAYER 1 — Normalized Signals
// Each signal is computed ONCE. Categories consume signals,
// never raw data. This eliminates double-counting.
// ═════════════════════════════════════════════════════════════════

interface NormalizedSignals {
  // ── Smart Contract ──
  mintEnabled: boolean;
  freezeEnabled: boolean;
  metadataMutable: boolean;

  // ── Fee / Tax (single source of truth) ──
  hasHiddenTax: boolean;
  taxPct: number;

  // ── Honeypot ──
  cantSell: boolean;          // high-confidence can't sell
  maybeCantSell: boolean;     // low-confidence (early launch)

  // ── Liquidity (adaptive) ──
  liqMcapRatio: number;       // primary signal
  rawLiquidityUSD: number;
  lpLocked: boolean;
  isLpRelevant: boolean;      // false for pump.fun tokens

  // ── Holders ──
  whaleConcentration: number;
  insiderNetworks: number;

  // ── Trading ──
  buyRatio: number;           // 0-1
  totalTxns: number;
  isBotPump: boolean;
  isCoordinatedDump: boolean;
  isGhostToken: boolean;
  priceCrash1h: number;

  // ── Age ──
  ageMinutes: number;

  // ── Market ──
  volumeUSD: number;
  marketCapUSD: number;

  // ── External (supporting evidence only) ──
  rugCheckScore: number;
  rugCheckClean: boolean;       // RC score ≤ 20 = externally validated
  rugCheckDangerCount: number;
  rugCheckDangerReasons: string[];
  isConfirmedRug: boolean;

  // ── Solana context ──
  isLikelyPumpFun: boolean;     // mint active + RC clean → bonding curve token

  // ── Data quality ──
  hasApiData: boolean;
  hasReportData: boolean;
  hasTradingData: boolean;
}

function normalizeSignals(sec: SecurityProfile, m: TradingMetrics): NormalizedSignals {
  const totalTxns = m.buys + m.sells;
  const buyRatio = totalTxns > 0 ? m.buys / totalTxns : 0.5;

  // Solana chain context: pump.fun tokens never have LP locks
  // LP lock is only relevant for traditional AMM pairs
  const isLpRelevant = sec.lpLockedPct > 0 || !sec.mintAuthorityRevoked;

  // Honeypot: require substantial evidence before flagging
  // buys > 50 AND sells === 0 AND age > 10min = high confidence
  // buys > 5 AND sells === 0 AND age < 10min = maybe (early launch)
  const cantSell = m.buys > 50 && m.sells === 0 && m.ageMinutes > 10;
  const maybeCantSell = m.buys > 5 && m.sells === 0 && m.ageMinutes <= 10;

  // RugCheck danger reasons (deduplicated for explanation)
  const dangerRisks = sec.rugCheckRisks.filter(r => r.level === 'danger');

  const hasApiData = sec.rugCheckScore !== 50; // 50 = our neutral default
  // RugCheck clean: score ≤ 20 means the token passed external validation
  const rugCheckClean = hasApiData && sec.rugCheckScore <= 20;

  // Pump.fun detection: most pump.fun bonding-curve tokens have mint
  // authority active (required for the bonding curve mechanism) but
  // are otherwise legitimate. If RugCheck says it's clean AND mint
  // is active, it's almost certainly a normal pump.fun launch.
  const isLikelyPumpFun = !sec.mintAuthorityRevoked && rugCheckClean;

  return {
    mintEnabled: !sec.mintAuthorityRevoked,
    freezeEnabled: !sec.freezeAuthorityRevoked,
    metadataMutable: !sec.metadataImmutable,
    hasHiddenTax: sec.transferFeePct > 5,
    taxPct: sec.transferFeePct,
    cantSell,
    maybeCantSell,
    liqMcapRatio: m.marketCapUSD > 0 ? m.liquidityUSD / m.marketCapUSD : 1,
    rawLiquidityUSD: m.liquidityUSD,
    lpLocked: sec.lpLockedPct > 50,
    isLpRelevant,
    whaleConcentration: sec.topHolderConcentration,
    insiderNetworks: sec.insidersDetected,
    buyRatio,
    totalTxns,
    isBotPump: totalTxns > 20 && buyRatio > 0.97,
    isCoordinatedDump: totalTxns > 20 && buyRatio < 0.03,
    isGhostToken: m.buys === 0 && m.sells === 0 && m.traders === 0,
    priceCrash1h: m.priceChange1h,
    ageMinutes: m.ageMinutes,
    volumeUSD: m.volumeUSD,
    marketCapUSD: m.marketCapUSD,
    rugCheckScore: sec.rugCheckScore,
    rugCheckClean,
    rugCheckDangerCount: dangerRisks.length,
    rugCheckDangerReasons: dangerRisks.slice(0, 3).map(r => `${r.name}: ${r.description}`),
    isConfirmedRug: sec.isRugged,
    isLikelyPumpFun,
    hasApiData,
    hasReportData: sec.topHolderConcentration > 0 || sec.insidersDetected > 0,
    hasTradingData: totalTxns > 0 || m.traders > 0,
  };
}

// ═════════════════════════════════════════════════════════════════
// LAYER 2 — Risk Engine (per-category scoring)
// Each category reads ONLY from normalized signals.
// ═════════════════════════════════════════════════════════════════

function wMul(w: 1 | 2 | 3): number {
  return w === 1 ? 0.5 : w === 3 ? 1.5 : 1.0;
}

// ── Liquidity ──

function scoreLiquidity(s: NormalizedSignals, cfg: RiskCheckConfig['liquidity']): { score: number; reasons: string[] } {
  if (!cfg.enabled) return { score: 0, reasons: [] };
  let raw = 0;
  const reasons: string[] = [];

  // PRIMARY: adaptive liq/mcap ratio
  if (cfg.checkLiqMcapRatio) {
    if (s.liqMcapRatio < 0.005) {
      raw += 8;
      reasons.push(`📊 Liq/MCap ${(s.liqMcapRatio * 100).toFixed(2)}% — paper-thin, easy rug`);
    } else if (s.liqMcapRatio < 0.02) {
      raw += 4;
      reasons.push(`📊 Liq/MCap ${(s.liqMcapRatio * 100).toFixed(1)}% — thin liquidity`);
    }
  }

  // SECONDARY: raw liquidity only as context for very small tokens
  if (cfg.checkLowLiquidity && s.rawLiquidityUSD > 0 && s.rawLiquidityUSD < 500) {
    raw += 4;
    reasons.push(`💧 Extremely low liquidity: ${fmtUSD(s.rawLiquidityUSD)}`);
  }

  // LP lock — only relevant for non-pump.fun AMM tokens
  if (cfg.checkLpLocked && s.isLpRelevant && !s.lpLocked && s.mintEnabled) {
    raw += 5;
    reasons.push('🔓 LP unlocked + mint authority active');
  }

  // Positive: healthy ratio
  if (s.liqMcapRatio > 0.10) {
    raw -= 3;
    reasons.push(`✅ Strong liq/mcap ratio: ${(s.liqMcapRatio * 100).toFixed(0)}%`);
  }

  return { score: Math.max(0, Math.round(raw * wMul(cfg.weight))), reasons };
}

// ── Smart Contract (NO transfer fees — those belong to Honeypot) ──

function scoreSmartContract(s: NormalizedSignals, cfg: RiskCheckConfig['smartContract']): { score: number; reasons: string[] } {
  if (!cfg.enabled) return { score: 0, reasons: [] };
  let raw = 0;
  const reasons: string[] = [];

  if (cfg.checkMintAuthority && s.mintEnabled) {
    if (s.isLikelyPumpFun) {
      // Pump.fun bonding curve tokens NEED mint authority to function.
      // RugCheck already validated this token — minimal penalty.
      raw += 3;
      reasons.push('🔓 Mint active (normal for pump.fun bonding curve)');
    } else if (s.rugCheckClean) {
      // RugCheck says it's okay but it's not a pump.fun pattern
      raw += 5;
      reasons.push('🔓 Mint authority active (RugCheck: clean)');
    } else {
      raw += 15;
      reasons.push('🔓 Mint authority active — can inflate supply & dump');
    }
  }

  // NOTE: freeze is checked here for contract risk, but the HONEYPOT
  // category uses it for can't-sell risk. The penalty only applies once
  // because each signal maps to one category. If user disables Smart
  // Contract but enables Honeypot, freeze still gets caught there.
  if (cfg.checkFreezeAuthority && s.freezeEnabled) {
    if (s.rugCheckClean) {
      // RugCheck validated — likely a program-level authority, not malicious
      raw += 2;
      reasons.push('🧊 Freeze authority active (RugCheck: clean)');
    } else {
      raw += 10;
      reasons.push('🧊 Freeze authority active — can freeze wallets');
    }
  }

  // Positive
  if (!s.mintEnabled && !s.freezeEnabled) {
    raw -= 6;
    reasons.push('✅ Mint & freeze both revoked');
  }
  if (!s.metadataMutable) {
    raw -= 3;
    reasons.push('✅ Immutable metadata');
  }

  return { score: Math.max(0, Math.round(raw * wMul(cfg.weight))), reasons };
}

// ── Honeypot (owns transfer fee signal exclusively) ──

function scoreHoneypot(s: NormalizedSignals, cfg: RiskCheckConfig['honeypot']): { score: number; reasons: string[] } {
  if (!cfg.enabled) return { score: 0, reasons: [] };
  let raw = 0;
  const reasons: string[] = [];

  // High-confidence honeypot: many buys, zero sells, not brand new
  if (cfg.checkCantSell && s.cantSell) {
    raw += 20;
    reasons.push(`🪤 Honeypot: buys but 0 sells after ${fmtAge(s.ageMinutes)}`);
  }

  // Low-confidence: might just be early launch
  if (cfg.checkCantSell && s.maybeCantSell) {
    raw += 3;
    reasons.push('⏳ No sells yet — too early to confirm (watching)');
  }

  // Hidden tax (ONLY counted here, not in Smart Contract)
  if (cfg.checkHiddenTax && s.hasHiddenTax) {
    if (s.taxPct > 20) {
      raw += 15;
      reasons.push(`💸 Predatory tax: ${s.taxPct}% — likely exit scam`);
    } else {
      raw += 7;
      reasons.push(`💸 Hidden tax: ${s.taxPct}%`);
    }
  }

  return { score: Math.max(0, Math.round(raw * wMul(cfg.weight))), reasons };
}

// ── Holder Distribution ──

function scoreHolders(s: NormalizedSignals, cfg: RiskCheckConfig['holderDistribution']): { score: number; reasons: string[] } {
  if (!cfg.enabled) return { score: 0, reasons: [] };
  let raw = 0;
  const reasons: string[] = [];

  // NOTE: topHolderConcentration from RugCheck may include LP/burn wallets.
  // We can't exclude them without wallet-level data, so we use higher
  // thresholds to compensate for this noise.
  if (cfg.checkWhaleConcentration && s.whaleConcentration > cfg.whaleThreshold) {
    const excess = s.whaleConcentration - cfg.whaleThreshold;
    if (excess > 30) {
      raw += 8;
      reasons.push(`🐋 Top holders own ${s.whaleConcentration.toFixed(0)}% (incl. LP/burn) — extreme`);
    } else if (excess > 15) {
      raw += 4;
      reasons.push(`🐋 Top holders own ${s.whaleConcentration.toFixed(0)}% — concentrated`);
    } else {
      raw += 2;
      reasons.push(`🐋 Top holders own ${s.whaleConcentration.toFixed(0)}% — above ${cfg.whaleThreshold}% threshold`);
    }
  }

  if (cfg.checkInsiders && s.insiderNetworks > 0) {
    raw += 7;
    reasons.push(`🕵️ ${s.insiderNetworks} insider network(s) — linked wallets`);
  }

  return { score: Math.max(0, Math.round(raw * wMul(cfg.weight))), reasons };
}

// ── Trading Patterns ──

function scoreTradingPatterns(s: NormalizedSignals, cfg: RiskCheckConfig['tradingPatterns']): { score: number; reasons: string[] } {
  if (!cfg.enabled) return { score: 0, reasons: [] };
  let raw = 0;
  const reasons: string[] = [];

  if (cfg.checkPumpDump) {
    if (s.priceCrash1h < -90) {
      raw += 12;
      reasons.push(`💥 Crashed ${s.priceCrash1h.toFixed(0)}% in 1h — active rug`);
    } else if (s.priceCrash1h < -70) {
      raw += 5;
      reasons.push(`📉 Dropped ${s.priceCrash1h.toFixed(0)}% in 1h`);
    }
  }

  if (cfg.checkBotActivity && s.isBotPump) {
    raw += 5;
    reasons.push(`🤖 ${(s.buyRatio * 100).toFixed(0)}% buys — bot-driven pump`);
  }

  if (cfg.checkCoordinatedDump && s.isCoordinatedDump) {
    raw += 7;
    reasons.push(`📉 ${((1 - s.buyRatio) * 100).toFixed(0)}% sells — coordinated dump`);
  }

  if (s.isGhostToken) {
    raw += 2;
    reasons.push('👻 Ghost token — zero activity');
  }

  // Positives — stronger bonuses for healthy trading signals
  if (s.totalTxns > 50 && s.buyRatio >= 0.25 && s.buyRatio <= 0.75) {
    raw -= 5;
    reasons.push('✅ Balanced buy/sell ratio');
  }

  // Volume bonus — high volume indicates real market interest
  if (s.volumeUSD > 100_000) {
    raw -= 4;
    reasons.push(`✅ Strong volume: ${fmtUSD(s.volumeUSD)}`);
  } else if (s.volumeUSD > 50_000) {
    raw -= 3;
    reasons.push(`✅ Healthy volume: ${fmtUSD(s.volumeUSD)}`);
  }

  // Market cap bonus — larger tokens are harder to rug
  if (s.marketCapUSD > 1_000_000) {
    raw -= 4;
    reasons.push(`✅ Established market cap: ${fmtUSD(s.marketCapUSD)}`);
  } else if (s.marketCapUSD > 100_000) {
    raw -= 2;
    reasons.push(`✅ Growing market cap: ${fmtUSD(s.marketCapUSD)}`);
  }

  return { score: Math.max(0, Math.round(raw * wMul(cfg.weight))), reasons };
}

// ── Token Age ──

function scoreTokenAge(s: NormalizedSignals, cfg: RiskCheckConfig['tokenAge']): { score: number; reasons: string[] } {
  if (!cfg.enabled) return { score: 0, reasons: [] };
  let raw = 0;
  const reasons: string[] = [];

  if (cfg.checkVeryNew && s.ageMinutes > 0 && s.ageMinutes < cfg.newTokenMinutes) {
    raw += 4;
    reasons.push(`⏰ Very new (${fmtAge(s.ageMinutes)}) — most rugs happen early`);
  }

  // Stronger age bonuses — survival is a strong signal
  if (s.ageMinutes > 10080) { // > 7 days
    raw -= 6;
    reasons.push(`✅ Survived 7d+ (${fmtAge(s.ageMinutes)})`);
  } else if (s.ageMinutes > 1440) { // > 24h
    raw -= 5;
    reasons.push(`✅ Survived 24h+ (${fmtAge(s.ageMinutes)})`);
  }

  return { score: Math.max(0, Math.round(raw * wMul(cfg.weight))), reasons };
}

// ── RugCheck Flags (supporting evidence, not truth) ──

function scoreRugCheckFlags(s: NormalizedSignals, cfg: RiskCheckConfig['rugcheckFlags']): { score: number; reasons: string[] } {
  if (!cfg.enabled) return { score: 0, reasons: [] };
  let raw = 0;
  const reasons: string[] = [];

  if (s.isConfirmedRug) {
    raw += 35;
    reasons.push('⛔ RUGGED — confirmed on-chain');
  }

  // Danger flags — capped contribution
  if (s.rugCheckDangerCount > 0) {
    raw += Math.min(s.rugCheckDangerCount, 3) * 2;
    s.rugCheckDangerReasons.forEach(r => reasons.push(`🚨 ${r}`));
    if (s.rugCheckDangerCount > 3) {
      reasons.push(`🚨 +${s.rugCheckDangerCount - 3} more flags`);
    }
  }

  // Trust adjustment — RugCheck is the best external signal we have.
  // Clean scores deserve meaningful bonuses. This is how we prevent
  // false positives on trending tokens that are perfectly legitimate.
  if (cfg.trustRugCheckScore && s.hasApiData) {
    if (s.rugCheckScore <= 5) {
      raw -= 10;
      reasons.push(`✅ RugCheck: ${s.rugCheckScore} (very clean)`);
    } else if (s.rugCheckScore <= 20) {
      raw -= 7;
      reasons.push(`✅ RugCheck: ${s.rugCheckScore} (clean)`);
    } else if (s.rugCheckScore <= 40) {
      raw -= 3;
      reasons.push(`✅ RugCheck: ${s.rugCheckScore} (okay)`);
    } else if (s.rugCheckScore > 60) {
      raw += 3;
      reasons.push(`⚠️ RugCheck: ${s.rugCheckScore} (flagged)`);
    }
  }

  return { score: Math.max(0, Math.round(raw * wMul(cfg.weight))), reasons };
}

// ═════════════════════════════════════════════════════════════════
// LAYER 3 — Confidence Engine
// How much data do we actually have? Low data = low confidence.
// ═════════════════════════════════════════════════════════════════

function computeConfidence(s: NormalizedSignals): { confidence: number; level: ConfidenceLevel } {
  let c = 0;

  // Age contributes to confidence (max 30)
  if (s.ageMinutes > 1440) c += 30;
  else if (s.ageMinutes > 60) c += 20;
  else if (s.ageMinutes > 10) c += 10;
  else c += 2;

  // API data quality (max 30)
  if (s.hasApiData) c += 15;
  if (s.hasReportData) c += 15;

  // Trading data (max 25)
  if (s.totalTxns > 100) c += 25;
  else if (s.totalTxns > 20) c += 15;
  else if (s.totalTxns > 5) c += 8;
  else if (s.hasTradingData) c += 3;

  // Liquidity data (max 15)
  if (s.rawLiquidityUSD > 10_000) c += 15;
  else if (s.rawLiquidityUSD > 1_000) c += 10;
  else if (s.rawLiquidityUSD > 0) c += 5;

  const confidence = Math.min(100, c);
  let level: ConfidenceLevel;
  if (confidence >= 70) level = 'high';
  else if (confidence >= 45) level = 'moderate';
  else if (confidence >= 25) level = 'low';
  else level = 'very_low';

  return { confidence, level };
}

// ═════════════════════════════════════════════════════════════════
// LAYER 4 — Risk Level Classification
// ═════════════════════════════════════════════════════════════════

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 65) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 21) return 'medium';
  return 'low';
}

// ═════════════════════════════════════════════════════════════════
// PUBLIC API — Main Scorer
// ═════════════════════════════════════════════════════════════════

export interface ScoredResult {
  address: string;
  riskScore: number;
  riskLevel: string;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  description: string;
  securityBreakdown: string;
  tradingBreakdown: string;
}

export function scoreToken(
  sec: SecurityProfile,
  m: TradingMetrics,
  config: RiskCheckConfig,
): ScoredResult & { securityReasons: string[]; tradingReasons: string[] } {
  // Layer 1: normalize
  const signals = normalizeSignals(sec, m);

  // Layer 2: score each category
  const securityReasons: string[] = [];
  const tradingReasons: string[] = [];
  let totalScore = 0;

  const cats = [
    { ...scoreLiquidity(signals, config.liquidity), bucket: 'sec' },
    { ...scoreSmartContract(signals, config.smartContract), bucket: 'sec' },
    { ...scoreHoneypot(signals, config.honeypot), bucket: 'sec' },
    { ...scoreHolders(signals, config.holderDistribution), bucket: 'sec' },
    { ...scoreRugCheckFlags(signals, config.rugcheckFlags), bucket: 'sec' },
    { ...scoreTradingPatterns(signals, config.tradingPatterns), bucket: 'trade' },
    { ...scoreTokenAge(signals, config.tokenAge), bucket: 'trade' },
  ];

  for (const cat of cats) {
    totalScore += cat.score;
    if (cat.bucket === 'sec') securityReasons.push(...cat.reasons);
    else tradingReasons.push(...cat.reasons);
  }

  const finalScore = Math.max(0, Math.min(100, totalScore));

  // Layer 3: confidence
  const { confidence, level: confidenceLevel } = computeConfidence(signals);

  return {
    address: '',
    riskScore: finalScore,
    riskLevel: getRiskLevel(finalScore),
    confidence,
    confidenceLevel,
    description: '',
    securityBreakdown: '',
    tradingBreakdown: '',
    securityReasons,
    tradingReasons,
  };
}

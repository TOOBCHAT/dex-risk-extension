/**
 * Shared Types — Solana-Only DEX Risk Extension
 * -----------------------------------------------
 * Uses RugCheck API (api.rugcheck.xyz) for on-chain security data
 * and DexScreener DOM scraping for real-time trading metrics.
 */

// ─── Risk Levels ────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'unknown' | 'error';

// ─── RugCheck API Types ─────────────────────────────────────────

/** Individual risk flag from RugCheck */
export interface RugCheckRisk {
  name: string;
  value: string;
  description: string;
  score: number;
  level: 'warn' | 'danger' | 'info' | 'good';
}

/** RugCheck /report/summary response */
export interface RugCheckSummary {
  tokenProgram: string;
  tokenType: string;
  risks: RugCheckRisk[];
  score: number;            // raw score (higher = riskier)
  score_normalised: number; // 0-100+ normalized (lower = safer: USDC=1, clean memecoin=16, risky=53)
  lpLockedPct: number;      // percentage of LP locked (0-100)
}

/** RugCheck /report response (key fields only) */
export interface RugCheckReport {
  mint: string;
  creator: string;
  creatorBalance: number;
  token: {
    mintAuthority: string | null;
    supply: number;
    decimals: number;
    isInitialized: boolean;
    freezeAuthority: string | null;
  };
  tokenMeta: {
    name: string;
    symbol: string;
    uri: string;
    mutable: boolean;
    updateAuthority: string;
  };
  topHolders: Array<{
    address: string;
    pct: number;
    owner: string;
    insider: boolean;
  }> | null;
  freezeAuthority: string | null;
  mintAuthority: string | null;
  risks: RugCheckRisk[];
  score: number;
  score_normalised: number;
  totalMarketLiquidity: number;
  totalLPProviders: number;
  totalHolders: number;
  price: number;
  rugged: boolean;
  transferFee: {
    pct: number;
    maxAmount: number;
    authority: string;
  };
  graphInsidersDetected: number;
}

// ─── DexScreener Trading Metrics (scraped from DOM) ─────────────

export interface TradingMetrics {
  marketCapUSD: number;
  ageMinutes: number;
  buys: number;
  sells: number;
  volumeUSD: number;
  traders: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  liquidityUSD: number;
}

// ─── Combined Risk Assessment ───────────────────────────────────

/** Security attributes from on-chain analysis */
export interface SecurityProfile {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  metadataImmutable: boolean;
  lpLockedPct: number;
  topHolderConcentration: number;  // top 10 holders % of supply
  insidersDetected: number;
  hasTransferFee: boolean;
  transferFeePct: number;
  isRugged: boolean;
  rugCheckScore: number;           // normalized 0-100+ from RugCheck (lower = safer)
  rugCheckRisks: RugCheckRisk[];
}

/** Confidence in the risk assessment */
export type ConfidenceLevel = 'very_low' | 'low' | 'moderate' | 'high';

/** Full risk score output for a token */
export interface RiskScore {
  address: string;
  riskScore: number;          // 0-100 (higher = more dangerous)
  riskLevel: RiskLevel;
  confidence: number;         // 0-100 (higher = more data available)
  confidenceLevel: ConfidenceLevel;
  description: string;
  securityBreakdown: string;  // detailed security info
  tradingBreakdown: string;   // detailed trading info
}

export interface ScoreResponse {
  scores: RiskScore[];
}

// ─── User-Configurable Risk Check Categories ────────────────────

/**
 * Each risk category can be toggled on/off independently.
 * Sub-checks within each category can also be individually toggled.
 * Weight controls how much impact this category has on the final score.
 * Weight: 1 = low (50% of base), 2 = normal (100%), 3 = high (150%)
 */

export interface LiquidityCheckConfig {
  enabled: boolean;
  checkLpLocked: boolean;       // LP tokens locked/burned?
  checkLowLiquidity: boolean;   // Dangerously low liquidity?
  checkLiqMcapRatio: boolean;   // Liq/Mcap ratio too low?
  weight: 1 | 2 | 3;
}

export interface SmartContractCheckConfig {
  enabled: boolean;
  checkMintAuthority: boolean;  // Can creator mint more tokens?
  checkFreezeAuthority: boolean;// Can creator freeze wallets?
  checkTransferFees: boolean;   // Hidden transfer taxes?
  weight: 1 | 2 | 3;
}

export interface HoneypotCheckConfig {
  enabled: boolean;
  checkCantSell: boolean;       // Buys work but sells fail
  checkHiddenTax: boolean;      // >10% sell tax
  weight: 1 | 2 | 3;
}

export interface HolderCheckConfig {
  enabled: boolean;
  checkWhaleConcentration: boolean; // Top holders own too much
  checkInsiders: boolean;           // Coordinated insider wallets
  whaleThreshold: number;           // % threshold (default 50)
  weight: 1 | 2 | 3;
}

export interface TradingPatternCheckConfig {
  enabled: boolean;
  checkPumpDump: boolean;       // Massive price crash patterns
  checkBotActivity: boolean;    // Bot-dominated trading
  checkCoordinatedDump: boolean;// Mass coordinated selling
  weight: 1 | 2 | 3;
}

export interface TokenAgeCheckConfig {
  enabled: boolean;
  checkVeryNew: boolean;        // Token < threshold age
  newTokenMinutes: number;      // Age threshold in minutes (default 60)
  weight: 1 | 2 | 3;
}

export interface RugCheckFlagsConfig {
  enabled: boolean;
  trustRugCheckScore: boolean;  // Use RC score to reduce penalties
  weight: 1 | 2 | 3;
}

export interface RiskCheckConfig {
  liquidity: LiquidityCheckConfig;
  smartContract: SmartContractCheckConfig;
  honeypot: HoneypotCheckConfig;
  holderDistribution: HolderCheckConfig;
  tradingPatterns: TradingPatternCheckConfig;
  tokenAge: TokenAgeCheckConfig;
  rugcheckFlags: RugCheckFlagsConfig;
}

// ─── Settings ───────────────────────────────────────────────────

export interface UserSettings {
  enabled: boolean;
  showBadgesOnAllTokens: boolean;
  riskChecks: RiskCheckConfig;
}

export const DEFAULT_RISK_CHECKS: RiskCheckConfig = {
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
    weight: 3,  // highest — these enable rug pulls
  },
  honeypot: {
    enabled: true,
    checkCantSell: true,
    checkHiddenTax: true,
    weight: 3,  // highest — you literally can't exit
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
};

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  showBadgesOnAllTokens: true,
  riskChecks: DEFAULT_RISK_CHECKS,
};

// ─── Messaging ──────────────────────────────────────────────────

export interface MessageRequest {
  action: 'GET_RISK_SCORES';
  payload: {
    tokens: Array<{ address: string; metrics: TradingMetrics }>;
  };
}

export interface MessageResponse {
  success: boolean;
  data?: ScoreResponse;
  error?: string;
}

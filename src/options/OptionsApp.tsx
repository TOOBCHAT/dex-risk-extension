import React, { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, DEFAULT_RISK_CHECKS } from '../types';
import type { UserSettings, RiskCheckConfig } from '../types';

// ─── Category Metadata ─────────────────────────────────────────

interface CategoryMeta {
  key: keyof RiskCheckConfig;
  icon: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  subchecks: Array<{
    key: string;
    label: string;
    desc: string;
  }>;
  hasThreshold?: {
    key: string;
    label: string;
    min: number;
    max: number;
    unit: string;
  };
}

const CATEGORIES: CategoryMeta[] = [
  {
    key: 'smartContract',
    icon: '📜',
    title: 'Smart Contract Risks',
    severity: 'critical',
    description: 'Checks if the contract owner can mint tokens, freeze wallets, or add hidden fees.',
    subchecks: [
      { key: 'checkMintAuthority', label: 'Mint Authority', desc: 'Can creator print unlimited tokens?' },
      { key: 'checkFreezeAuthority', label: 'Freeze Authority', desc: 'Can creator freeze your wallet?' },
      { key: 'checkTransferFees', label: 'Transfer Fees', desc: 'Hidden tax on transfers?' },
    ],
  },
  {
    key: 'honeypot',
    icon: '🪤',
    title: 'Honeypot Detection',
    severity: 'critical',
    description: 'Detects tokens where you can buy but cannot sell — the #1 scam pattern.',
    subchecks: [
      { key: 'checkCantSell', label: "Can't Sell Detection", desc: 'Buys work but sells fail' },
      { key: 'checkHiddenTax', label: 'Hidden Sell Tax', desc: 'Sell tax >10%' },
    ],
  },
  {
    key: 'liquidity',
    icon: '💧',
    title: 'Liquidity Signals',
    severity: 'high',
    description: 'Analyzes LP lock status, liquidity depth, and liquidity-to-market-cap ratios.',
    subchecks: [
      { key: 'checkLpLocked', label: 'LP Lock Status', desc: 'Is liquidity locked or burnable?' },
      { key: 'checkLowLiquidity', label: 'Low Liquidity', desc: 'Dangerously thin liquidity pool' },
      { key: 'checkLiqMcapRatio', label: 'Liq/MCap Ratio', desc: 'Liquidity too small vs market cap' },
    ],
  },
  {
    key: 'holderDistribution',
    icon: '🐋',
    title: 'Holder Distribution',
    severity: 'high',
    description: 'Checks whale concentration and coordinated insider wallet networks.',
    subchecks: [
      { key: 'checkWhaleConcentration', label: 'Whale Concentration', desc: 'Top holders own too much supply' },
      { key: 'checkInsiders', label: 'Insider Networks', desc: 'Wallets linked by funding source' },
    ],
    hasThreshold: {
      key: 'whaleThreshold',
      label: 'Whale alert threshold',
      min: 20,
      max: 90,
      unit: '%',
    },
  },
  {
    key: 'tradingPatterns',
    icon: '📊',
    title: 'Trading Pattern Analysis',
    severity: 'medium',
    description: 'Detects pump-and-dump patterns, bot activity, and coordinated selling.',
    subchecks: [
      { key: 'checkPumpDump', label: 'Pump & Dump', desc: 'Massive price crash patterns' },
      { key: 'checkBotActivity', label: 'Bot Activity', desc: '>98% buy ratio (artificial pump)' },
      { key: 'checkCoordinatedDump', label: 'Coordinated Dump', desc: 'Mass synchronized selling' },
    ],
  },
  {
    key: 'tokenAge',
    icon: '⏰',
    title: 'Token Age & Launch Risk',
    severity: 'medium',
    description: 'New tokens have higher rug risk. Most rugs happen in the first hours.',
    subchecks: [
      { key: 'checkVeryNew', label: 'Very New Token', desc: 'Token younger than threshold' },
    ],
    hasThreshold: {
      key: 'newTokenMinutes',
      label: 'New token threshold',
      min: 5,
      max: 1440,
      unit: 'min',
    },
  },
  {
    key: 'rugcheckFlags',
    icon: '🛡️',
    title: 'RugCheck Analysis',
    severity: 'high',
    description: 'Uses RugCheck API danger flags and their normalized trust score.',
    subchecks: [
      { key: 'trustRugCheckScore', label: 'Trust RugCheck Score', desc: 'Use their score to adjust penalties' },
    ],
  },
];

const WEIGHT_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Normal',
  3: 'High',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#6366f1',
};

// ─── Component ──────────────────────────────────────────────────

export default function OptionsApp() {
  const [settings, setSettings] = useState<UserSettings>({ ...DEFAULT_SETTINGS });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    chrome.storage.sync.get(null, (stored) => {
      const merged: UserSettings = {
        ...DEFAULT_SETTINGS,
        ...(stored as Partial<UserSettings>),
        riskChecks: {
          ...DEFAULT_RISK_CHECKS,
          ...((stored as any)?.riskChecks || {}),
        },
      };
      setSettings(merged);
      setLoading(false);
    });
  }, []);

  function handleTopLevelChange<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleCategoryToggle(catKey: keyof RiskCheckConfig) {
    setSettings(prev => ({
      ...prev,
      riskChecks: {
        ...prev.riskChecks,
        [catKey]: {
          ...prev.riskChecks[catKey],
          enabled: !prev.riskChecks[catKey].enabled,
        },
      },
    }));
    setSaved(false);
  }

  function handleSubcheckToggle(catKey: keyof RiskCheckConfig, subKey: string) {
    setSettings(prev => ({
      ...prev,
      riskChecks: {
        ...prev.riskChecks,
        [catKey]: {
          ...prev.riskChecks[catKey],
          [subKey]: !(prev.riskChecks[catKey] as any)[subKey],
        },
      },
    }));
    setSaved(false);
  }

  function handleWeightChange(catKey: keyof RiskCheckConfig, weight: 1 | 2 | 3) {
    setSettings(prev => ({
      ...prev,
      riskChecks: {
        ...prev.riskChecks,
        [catKey]: {
          ...prev.riskChecks[catKey],
          weight,
        },
      },
    }));
    setSaved(false);
  }

  function handleThresholdChange(catKey: keyof RiskCheckConfig, threshKey: string, value: number) {
    setSettings(prev => ({
      ...prev,
      riskChecks: {
        ...prev.riskChecks,
        [catKey]: {
          ...prev.riskChecks[catKey],
          [threshKey]: value,
        },
      },
    }));
    setSaved(false);
  }

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSave() {
    chrome.storage.sync.set(settings, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  function handleReset() {
    setSettings({ ...DEFAULT_SETTINGS });
    chrome.storage.sync.set(DEFAULT_SETTINGS);
    setSaved(false);
  }

  function enabledCount(): number {
    return CATEGORIES.filter(c => settings.riskChecks[c.key].enabled).length;
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading settings…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div className="header__logo">
          <div className="logo-icon" aria-hidden="true">🛡️</div>
          <div>
            <h1 className="header__title">DEX Risk Scanner</h1>
            <p className="header__subtitle">Configure your rug detection checks</p>
          </div>
        </div>
        <div className={`status-chip ${settings.enabled ? 'status-chip--on' : 'status-chip--off'}`}>
          {settings.enabled ? '● Active' : '○ Disabled'}
        </div>
      </header>

      <main className="main">
        {/* Master Toggle */}
        <section className="card">
          <div className="setting-row" style={{ borderTop: 'none' }}>
            <div className="setting-row__info">
              <label className="setting-row__label" htmlFor="toggle-enabled">
                Enable Extension
              </label>
              <p className="setting-row__desc">
                Show risk check buttons on DexScreener Solana tokens.
              </p>
            </div>
            <label className="toggle" htmlFor="toggle-enabled">
              <input
                id="toggle-enabled"
                type="checkbox"
                checked={settings.enabled}
                onChange={e => handleTopLevelChange('enabled', e.target.checked)}
              />
              <span className="toggle__track" />
            </label>
          </div>
        </section>

        {/* Active checks summary */}
        <div className="checks-summary">
          <span className="checks-summary__count">{enabledCount()}</span>
          <span className="checks-summary__label">of {CATEGORIES.length} risk categories active</span>
        </div>

        {/* Risk Category Cards */}
        {CATEGORIES.map(cat => {
          const catConfig = settings.riskChecks[cat.key];
          const isExpanded = expanded.has(cat.key);
          const severityColor = SEVERITY_COLORS[cat.severity];

          return (
            <section
              key={cat.key}
              className={`risk-card ${catConfig.enabled ? 'risk-card--enabled' : 'risk-card--disabled'}`}
            >
              {/* Card Header */}
              <div className="risk-card__header">
                <div className="risk-card__left" onClick={() => toggleExpand(cat.key)}>
                  <span className="risk-card__icon">{cat.icon}</span>
                  <div>
                    <div className="risk-card__title">{cat.title}</div>
                    <div className="risk-card__severity" style={{ color: severityColor }}>
                      {cat.severity.toUpperCase()} SEVERITY
                    </div>
                  </div>
                  <span className={`risk-card__chevron ${isExpanded ? 'risk-card__chevron--open' : ''}`}>
                    ▸
                  </span>
                </div>
                <label className="toggle" htmlFor={`toggle-${cat.key}`}>
                  <input
                    id={`toggle-${cat.key}`}
                    type="checkbox"
                    checked={catConfig.enabled}
                    onChange={() => handleCategoryToggle(cat.key)}
                  />
                  <span className="toggle__track" />
                </label>
              </div>

              {/* Description */}
              <p className="risk-card__desc">{cat.description}</p>

              {/* Expanded: Sub-checks + Weight */}
              {isExpanded && catConfig.enabled && (
                <div className="risk-card__body">
                  {/* Sub-checks */}
                  {cat.subchecks.map(sub => (
                    <div key={sub.key} className="subcheck">
                      <div className="subcheck__info">
                        <span className="subcheck__label">{sub.label}</span>
                        <span className="subcheck__desc">{sub.desc}</span>
                      </div>
                      <label className="toggle toggle--small" htmlFor={`toggle-${cat.key}-${sub.key}`}>
                        <input
                          id={`toggle-${cat.key}-${sub.key}`}
                          type="checkbox"
                          checked={(catConfig as any)[sub.key]}
                          onChange={() => handleSubcheckToggle(cat.key, sub.key)}
                        />
                        <span className="toggle__track toggle__track--small" />
                      </label>
                    </div>
                  ))}

                  {/* Threshold slider */}
                  {cat.hasThreshold && (
                    <div className="threshold-row">
                      <span className="threshold-row__label">{cat.hasThreshold.label}</span>
                      <div className="slider-group">
                        <input
                          type="range"
                          className="slider slider--purple"
                          min={cat.hasThreshold.min}
                          max={cat.hasThreshold.max}
                          value={(catConfig as any)[cat.hasThreshold.key]}
                          onChange={e =>
                            handleThresholdChange(cat.key, cat.hasThreshold!.key, Number(e.target.value))
                          }
                        />
                        <span className="slider-value slider-value--purple">
                          {(catConfig as any)[cat.hasThreshold.key]}{cat.hasThreshold.unit}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Weight selector */}
                  <div className="weight-row">
                    <span className="weight-row__label">Priority</span>
                    <div className="weight-pills">
                      {([1, 2, 3] as const).map(w => (
                        <button
                          key={w}
                          className={`weight-pill ${catConfig.weight === w ? 'weight-pill--active' : ''}`}
                          onClick={() => handleWeightChange(cat.key, w)}
                        >
                          {WEIGHT_LABELS[w]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </main>

      <footer className="footer">
        <button
          id="btn-reset"
          className="btn btn--secondary"
          onClick={handleReset}
        >
          Reset Defaults
        </button>
        <button
          id="btn-save"
          className={`btn btn--primary ${saved ? 'btn--saved' : ''}`}
          onClick={handleSave}
        >
          {saved ? '✅ Saved!' : 'Save Settings'}
        </button>
      </footer>
    </div>
  );
}

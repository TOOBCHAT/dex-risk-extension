import type { RiskLevel, RiskScore, ConfidenceLevel } from '../../types';

/**
 * Creates a "Check Risk" button that the user clicks to scan a token.
 * This is the default state for every Solana token row.
 */
export function createCheckButton(address: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'drex-check-btn';
  btn.setAttribute('aria-label', `Check risk for ${address}`);
  btn.dataset.drexAddress = address;

  // Shield icon + text
  btn.innerHTML = `
    <svg class="drex-check-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
    <span>Check</span>
  `;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  }, { once: true });

  return btn;
}

/**
 * Creates a single risk badge DOM element for a given risk score.
 * Includes confidence indicator and breakdowns in the tooltip.
 */
export function createRiskBadge(score: RiskScore): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `drex-badge drex-badge--${score.riskLevel}`;
  badge.setAttribute('role', 'img');
  badge.setAttribute(
    'aria-label',
    `Risk: ${score.riskLevel.toUpperCase()} (${Math.round(score.riskScore)}/100) — Confidence: ${score.confidenceLevel}`
  );
  badge.dataset.drexAddress = score.address;

  // Dot indicator
  const dot = document.createElement('span');
  dot.className = 'drex-badge__dot';
  dot.setAttribute('aria-hidden', 'true');
  badge.appendChild(dot);

  // Label text
  const label = document.createElement('span');
  label.textContent = getLabelText(score.riskLevel);
  badge.appendChild(label);

  // Confidence indicator (small text after the label)
  if (score.confidenceLevel === 'very_low' || score.confidenceLevel === 'low') {
    const confTag = document.createElement('span');
    confTag.className = 'drex-badge__confidence';
    confTag.textContent = score.confidenceLevel === 'very_low' ? '?' : '~';
    confTag.title = `Confidence: ${score.confidenceLevel.replace('_', ' ')} (${score.confidence}%)`;
    badge.appendChild(confTag);
  }

  // Tooltip on hover
  badge.appendChild(createTooltip(score));

  return badge;
}

/**
 * Creates a loading badge while waiting for API response.
 */
export function createLoadingBadge(address: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'drex-badge drex-badge--loading';
  badge.setAttribute('aria-label', 'Scanning via RugCheck…');
  badge.dataset.drexAddress = address;
  badge.dataset.drexLoading = 'true';

  const spinner = document.createElement('span');
  spinner.className = 'drex-badge__spinner';
  spinner.setAttribute('aria-hidden', 'true');
  badge.appendChild(spinner);

  const label = document.createElement('span');
  label.textContent = 'Scanning…';
  badge.appendChild(label);

  return badge;
}

/**
 * Creates an error badge when the API call fails.
 */
export function createErrorBadge(address: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'drex-badge drex-badge--error';
  badge.setAttribute('aria-label', 'Risk analysis unavailable');
  badge.dataset.drexAddress = address;

  const dot = document.createElement('span');
  dot.className = 'drex-badge__dot';
  badge.appendChild(dot);

  const label = document.createElement('span');
  label.textContent = 'Error';
  badge.appendChild(label);

  return badge;
}

function createTooltip(score: RiskScore): HTMLElement {
  const tooltip = document.createElement('span');
  tooltip.className = 'drex-tooltip';

  // Header
  const header = document.createElement('div');
  header.className = 'drex-tooltip__header';
  header.textContent = `${getEmoji(score.riskLevel)} ${score.riskLevel.toUpperCase()} RISK`;
  tooltip.appendChild(header);

  // Score + Confidence
  const scoreEl = document.createElement('div');
  scoreEl.className = 'drex-tooltip__score';
  scoreEl.textContent = `Score: ${Math.round(score.riskScore)}/100`;
  tooltip.appendChild(scoreEl);

  // Confidence line
  const confEl = document.createElement('div');
  confEl.className = `drex-tooltip__confidence drex-tooltip__confidence--${score.confidenceLevel}`;
  confEl.textContent = `Confidence: ${score.confidenceLevel.replace('_', ' ').toUpperCase()} (${score.confidence}%)`;
  tooltip.appendChild(confEl);

  // Visual score bar
  const barContainer = document.createElement('div');
  barContainer.className = 'drex-tooltip__bar-container';
  const barFill = document.createElement('div');
  barFill.className = `drex-tooltip__bar-fill drex-tooltip__bar-fill--${score.riskLevel}`;
  barFill.style.width = `${Math.min(100, score.riskScore)}%`;
  barContainer.appendChild(barFill);
  tooltip.appendChild(barContainer);

  // Security breakdown
  if (score.securityBreakdown && score.securityBreakdown !== 'No security issues found') {
    const secHeader = document.createElement('div');
    secHeader.className = 'drex-tooltip__section-header';
    secHeader.textContent = '🔒 On-Chain Security';
    tooltip.appendChild(secHeader);

    const secDesc = document.createElement('div');
    secDesc.className = 'drex-tooltip__desc';
    secDesc.textContent = score.securityBreakdown;
    tooltip.appendChild(secDesc);
  }

  // Trading breakdown
  if (score.tradingBreakdown && score.tradingBreakdown !== 'No trading concerns') {
    const tradeHeader = document.createElement('div');
    tradeHeader.className = 'drex-tooltip__section-header';
    tradeHeader.textContent = '📊 Trading Activity';
    tooltip.appendChild(tradeHeader);

    const tradeDesc = document.createElement('div');
    tradeDesc.className = 'drex-tooltip__desc';
    tradeDesc.textContent = score.tradingBreakdown;
    tooltip.appendChild(tradeDesc);
  }

  // Data source attribution
  const source = document.createElement('div');
  source.className = 'drex-tooltip__source';
  source.textContent = 'Data: RugCheck + DexScreener';
  tooltip.appendChild(source);

  return tooltip;
}

function getLabelText(level: RiskLevel): string {
  switch (level) {
    case 'critical': return '☠️ SCAM';
    case 'high': return '🚩 HIGH';
    case 'medium': return '⚠️ CAUTION';
    case 'low': return '✅ SAFE';
    default: return '? N/A';
  }
}

function getEmoji(level: RiskLevel): string {
  switch (level) {
    case 'critical': return '☠️';
    case 'high': return '🚩';
    case 'medium': return '⚠️';
    case 'low': return '✅';
    default: return '❓';
  }
}

/**
 * UI Elements
 * -----------
 * Creates the floating refresh button and notification banner
 * that the extension injects into DexScreener pages.
 */

// ─── Notification Banner ────────────────────────────────────────

/**
 * Shows a temporary notification banner at the top of the page.
 * Auto-removes after 4 seconds.
 */
export function showNotification(message: string, type: 'info' | 'error' = 'info'): void {
  const existing = document.getElementById('drex-notification');
  existing?.remove();

  const el = document.createElement('div');
  el.id = 'drex-notification';
  el.className = `drex-notification drex-notification--${type}`;
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => el.remove(), 4000);
}

// ─── Refresh Button ─────────────────────────────────────────────

/**
 * Creates a floating "Re-scan Risks" button.
 * @param onRescan — callback invoked when the user clicks the button.
 */
export function createRefreshButton(onRescan: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'drex-refresh-btn';
  btn.className = 'drex-refresh-btn';
  btn.setAttribute('aria-label', 'Refresh DEX Risk Scores');
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 2v6h-6"/>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
      <path d="M3 22v-6h6"/>
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
    </svg>
    Re-scan Risks
  `;
  btn.addEventListener('click', onRescan);
  return btn;
}

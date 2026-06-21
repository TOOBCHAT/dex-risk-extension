/**
 * Style Injector
 * --------------
 * Handles injecting badge CSS into the DexScreener page.
 * Creates a Shadow DOM host for CSS isolation and also
 * injects styles directly into <head> for real-DOM badges.
 */

import badgeCss from './badge.css?inline';

let shadowHost: HTMLElement | null = null;

/**
 * Injects badge styles into the page (idempotent — safe to call multiple times).
 * Uses Vite's `?inline` import to bundle CSS as a string at build time.
 */
export function ensureShadowStyles(): void {
  if (shadowHost) return;

  // Hidden Shadow DOM host (CSS isolation guard)
  shadowHost = document.createElement('div');
  shadowHost.id = 'drex-shadow-host';
  shadowHost.style.cssText = 'display:none;position:absolute;width:0;height:0;overflow:hidden;';
  document.body.appendChild(shadowHost);

  const shadow = shadowHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = badgeCss;
  shadow.appendChild(style);

  // Also inject into real document <head> so badges in the real DOM are styled
  const docStyle = document.createElement('style');
  docStyle.id = 'drex-styles';
  docStyle.textContent = badgeCss;
  document.head.appendChild(docStyle);
}

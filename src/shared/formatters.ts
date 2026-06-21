/**
 * Formatting Utilities
 * --------------------
 * Human-readable formatters for USD values and time durations.
 * Used by the risk scorer to build readable descriptions.
 */

/** Formats a number as a compact USD string: 1500000 → "$1.5M" */
export function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Formats minutes into a readable duration: 90 → "1.5h", 2880 → "2.0d" */
export function fmtAge(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / 1440).toFixed(1)}d`;
}

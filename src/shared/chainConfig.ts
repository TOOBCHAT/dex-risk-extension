/**
 * Chain Configuration — Solana Only
 * ----------------------------------
 * This extension is focused exclusively on Solana tokens.
 * The normalizer handles DexScreener URL slugs for Solana.
 */

/** Maps DexScreener URL slugs for Solana to our canonical ID. */
export const CHAIN_SLUG_MAP: Record<string, string> = {
  solana: 'solana',
  sol: 'solana',
};

/** Only Solana is supported. */
export const SUPPORTED_CHAINS = [
  { id: 'solana', label: 'Solana (SOL)' },
] as const;

/**
 * Normalizes a raw DexScreener URL slug to our canonical chain ID.
 * Returns 'solana' for sol/solana slugs, or the slug itself for others.
 */
export function normalizeChainSlug(slug: string): string {
  return CHAIN_SLUG_MAP[slug.toLowerCase()] || slug.toLowerCase();
}

/**
 * Checks if a chain slug is Solana.
 */
export function isSolana(slug: string): boolean {
  return normalizeChainSlug(slug) === 'solana';
}

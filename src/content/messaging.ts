import type { MessageRequest, MessageResponse, ScoreResponse, TradingMetrics } from '../types';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

interface TokenPayload {
  address: string;
  metrics: TradingMetrics;
}

/**
 * Sends Solana token addresses + trading metrics to the Background
 * Service Worker for risk scoring (RugCheck API + trading analysis).
 * Implements exponential backoff retry.
 */
export async function requestRiskScores(
  tokens: TokenPayload[],
  attempt = 0
): Promise<ScoreResponse> {
  const message: MessageRequest = {
    action: 'GET_RISK_SCORES',
    payload: { tokens },
  };

  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: MessageResponse) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message ?? 'Unknown error';
          console.error('[DEX Risk] Runtime error:', errMsg);

          if (attempt < MAX_RETRIES) {
            console.log(`[DEX Risk] Retrying in ${RETRY_DELAYS_MS[attempt]}ms… (attempt ${attempt + 1}/${MAX_RETRIES})`);
            setTimeout(() => {
              requestRiskScores(tokens, attempt + 1).then(resolve).catch(reject);
            }, RETRY_DELAYS_MS[attempt]);
          } else {
            reject(new Error(errMsg));
          }
          return;
        }

        if (!response?.success) {
          const err = response?.error ?? 'API returned failure';
          if (attempt < MAX_RETRIES) {
            console.log(`[DEX Risk] API failure, retrying… (attempt ${attempt + 1}/${MAX_RETRIES})`);
            setTimeout(() => {
              requestRiskScores(tokens, attempt + 1).then(resolve).catch(reject);
            }, RETRY_DELAYS_MS[attempt]);
          } else {
            reject(new Error(err));
          }
          return;
        }

        resolve(response.data!);
      });
    } catch (err) {
      reject(err);
    }
  });
}

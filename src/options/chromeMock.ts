/**
 * Chrome API mock for development/preview environment.
 * This file is ONLY loaded when running outside of Chrome (npm run dev).
 * It simulates chrome.storage.sync using localStorage so the Options page
 * renders and behaves correctly in the Vite dev server.
 */

const STORAGE_KEY = 'drex_dev_storage';

function readStore(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const listeners: Array<
  (changes: Record<string, { oldValue?: unknown; newValue: unknown }>, area: string) => void
> = [];

const chromeMock = {
  storage: {
    sync: {
      get(keys: string | string[], callback: (items: Record<string, unknown>) => void) {
        const store = readStore();
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          keys.forEach(k => { result[k] = store[k]; });
          callback(result);
        } else {
          callback({ [keys]: store[keys] });
        }
      },
      set(items: Record<string, unknown>, callback?: () => void) {
        const store = readStore();
        const changes: Record<string, { oldValue?: unknown; newValue: unknown }> = {};
        Object.entries(items).forEach(([k, v]) => {
          changes[k] = { oldValue: store[k], newValue: v };
          store[k] = v;
        });
        writeStore(store);
        listeners.forEach(fn => fn(changes, 'sync'));
        callback?.();
      },
    },
    onChanged: {
      addListener(
        fn: (changes: Record<string, { oldValue?: unknown; newValue: unknown }>, area: string) => void
      ) {
        listeners.push(fn);
      },
    },
  },
  runtime: {
    sendMessage() {},
    lastError: null,
  },
};

// Only install mock when not running inside Chrome
if (typeof chrome === 'undefined' || !chrome.storage) {
  (window as any).chrome = chromeMock;
}

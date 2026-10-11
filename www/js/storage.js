import { DEFAULT_STORES, createDefaultFunds, state } from './state.js';

export const DB_NAME = 'salarywise-db';
export const DB_VERSION = 4;
const STORAGE_KEY = 'salarywise_app_v1';
const STORE_NAMES = ['meta', 'user', 'products', 'stores', 'cart', 'scanCart', 'transactions', 'settings', 'funds', 'app'];
let db = null;
let usingIndexedDb = false;

function snapshot(source = state) {
  return {
    user: source.user,
    products: source.products || [],
    stores: source.stores || [],
    cart: source.cart || [],
    scanCart: source.scanCart || [],
    scanMarket: source.scanMarket || '',
    transactions: source.transactions || [],
    funds: source.funds || createDefaultFunds(),
    removedFundTypes: source.removedFundTypes || [],
    settings: {
      theme: 'light',
      cartAdditionalCharges: 0,
      scanAdditionalCharges: 0,
      aiBudgeting: { enabled: false, provider: 'openrouter', model: '' },
      ...(source.settings || {})
    }
  };
}

function applySnapshot(data) {
  Object.assign(state, {
    user: data.user || null,
    products: Array.isArray(data.products) ? data.products : [],
    stores: Array.isArray(data.stores) ? data.stores : [],
    cart: Array.isArray(data.cart) ? data.cart : [],
    scanCart: Array.isArray(data.scanCart) ? data.scanCart : [],
    scanMarket: data.scanMarket || '',
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    funds: Array.isArray(data.funds) ? data.funds : createDefaultFunds(),
    removedFundTypes: Array.isArray(data.removedFundTypes) ? data.removedFundTypes : [],
    settings: {
      theme: 'light',
      cartAdditionalCharges: 0,
      scanAdditionalCharges: 0,
      aiBudgeting: { enabled: false, provider: 'openrouter', model: '' },
      ...(data.settings || {})
    }
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

async function putSnapshotTransaction(data) {
  const stores = ['meta', 'user', 'products', 'stores', 'cart', 'scanCart', 'transactions', 'settings', 'funds'];
  // Read lastWrites before opening the write transaction
  let previousWrites = [];
  try {
    previousWrites = (await readStore('lastWrites', 'meta'))?.value || [];
  } catch (_) { /* ignore */ }

  const tx = db.transaction(stores, 'readwrite');
  tx.objectStore('meta').put({ key: 'seeded', value: true });
  tx.objectStore('meta').put({ key: 'schemaVersion', value: DB_VERSION });
  tx.objectStore('meta').put({ key: 'lastWriteAt', value: new Date().toISOString() });
  tx.objectStore('meta').put({
    key: 'lastWrites',
    value: [...previousWrites, {
      at: new Date().toISOString(),
      counts: {
        products: data.products.length,
        cart: data.cart.length,
        scanCart: data.scanCart.length,
        transactions: data.transactions.length,
        funds: data.funds.length
      }
    }].slice(-5)
  });
  tx.objectStore('user').put({ key: 'user', value: data.user });
  tx.objectStore('products').put({ key: 'products', value: data.products });
  tx.objectStore('stores').put({ key: 'stores', value: data.stores });
  tx.objectStore('cart').put({ key: 'cart', value: data.cart });
  tx.objectStore('scanCart').put({ key: 'scanCart', value: data.scanCart });
  tx.objectStore('scanCart').put({ key: 'scanMarket', value: data.scanMarket });
  tx.objectStore('transactions').put({ key: 'transactions', value: data.transactions });
  tx.objectStore('settings').put({ key: 'settings', value: data.settings });
  tx.objectStore('funds').put({ key: 'funds', value: data.funds });
  tx.objectStore('funds').put({ key: 'removedFundTypes', value: data.removedFundTypes });
  return transactionToPromise(tx);
}

async function readStore(key, storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).get(key));
}

async function migrateLegacySnapshot() {
  try {
    const legacy = await readStore('state', 'app');
    if (!legacy?.value) return null;
    const data = legacy.value;
    const normalized = {
      user: data.user || null,
      products: data.products || [],
      stores: data.stores || [],
      cart: data.cart || [],
      scanCart: data.scanCart || [],
      scanMarket: data.scanMarket || '',
      transactions: data.transactions || [],
      funds: data.funds || createDefaultFunds(),
      removedFundTypes: data.removedFundTypes || [],
      settings: data.settings || { theme: 'light' }
    };
    await putSnapshotTransaction(normalized);
    return normalized;
  } catch (_) {
    return null;
  }
}

async function readIndexedDbState() {
  const seededRecord = await readStore('seeded', 'meta');
  const userRecord = await readStore('user', 'user');

  // No seeded flag and no user: try legacy migration first
  if (!seededRecord && !userRecord) {
    return migrateLegacySnapshot();
  }

  // Has seeded flag or user record — load all stores
  return {
    user: userRecord?.value || null,
    products: (await readStore('products', 'products'))?.value || [],
    stores: (await readStore('stores', 'stores'))?.value || [],
    cart: (await readStore('cart', 'cart'))?.value || [],
    scanCart: (await readStore('scanCart', 'scanCart'))?.value || [],
    scanMarket: (await readStore('scanMarket', 'scanCart'))?.value || '',
    transactions: (await readStore('transactions', 'transactions'))?.value || [],
    funds: (await readStore('funds', 'funds'))?.value || createDefaultFunds(),
    removedFundTypes: (await readStore('funds', 'removedFundTypes'))?.value || [],
    settings: (await readStore('settings', 'settings'))?.value || { theme: 'light' }
  };
}

export async function initStorage() {
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch (error) { console.warn('Persistent storage request failed', error); }
  }
  try {
    if (!('indexedDB' in window)) throw new Error('IndexedDB unavailable');
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      const openTimeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out opening IndexedDB. Close other SalaryWise tabs and restart the app.'));
      }, 3000);
      request.onupgradeneeded = () => {
        const database = request.result;
        // SAFE: only create stores that don't already exist — never delete or clear
        STORE_NAMES.forEach((name) => {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: 'key' });
          }
        });
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        window.clearTimeout(openTimeout);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(openTimeout);
        reject(request.error || new Error('Unable to open IndexedDB'));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(openTimeout);
        reject(new Error('IndexedDB upgrade is blocked by another open SalaryWise tab. Close the other tab and restart the app.'));
      };
    });
    usingIndexedDb = true;
    return true;
  } catch (error) {
    usingIndexedDb = false;
    console.warn('Using localStorage persistence fallback', error);
    return false;
  }
}

export async function loadState() {
  if (usingIndexedDb) {
    let data = null;
    try {
      data = await readIndexedDbState();
    } catch (error) {
      console.warn('IndexedDB read failed, falling back to localStorage', error);
    }

    if (data) {
      // IndexedDB has data — but if it looks empty (no user, no products, no transactions),
      // check localStorage for a richer backup before trusting the empty IndexedDB state.
      const idbEmpty = !data.user && (!data.products || data.products.length === 0) && (!data.transactions || data.transactions.length === 0);
      if (idbEmpty) {
        const lsData = getLocalStorageData();
        if (lsData && (lsData.user || (Array.isArray(lsData.products) && lsData.products.length))) {
          // localStorage has richer data — use it and re-persist to IndexedDB
          applySnapshot(lsData);
          try { await putSnapshotTransaction(snapshot(state)); } catch (_) { /* best effort */ }
          return lsData;
        }
      }
      applySnapshot(data);
      return data;
    }

    // IndexedDB returned null (no seeded flag, no user, no legacy data)
    // Fall through to localStorage check
    const lsData = getLocalStorageData();
    if (lsData) {
      applySnapshot(lsData);
      // Re-persist to IndexedDB so future loads use IndexedDB
      try { await putSnapshotTransaction(snapshot(state)); } catch (_) { /* best effort */ }
      return lsData;
    }
    return null;
  }

  // IndexedDB unavailable — use localStorage only
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    applySnapshot(data);
    return data;
  } catch (_) {
    return null;
  }
}

export async function persistState(source = state) {
  const data = snapshot(source);
  if (usingIndexedDb) {
    await putSnapshotTransaction(data);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  applySnapshot(data);
  return true;
}

export async function persistAtomic(nextState) {
  return persistState(nextState);
}

export async function resetAllData() {
  const stores = ['meta', 'user', 'products', 'stores', 'cart', 'scanCart', 'transactions', 'settings', 'funds'];
  if (usingIndexedDb) {
    const tx = db.transaction([...stores, 'app'], 'readwrite');
    [...stores, 'app'].forEach((name) => tx.objectStore(name).clear());
    tx.objectStore('meta').put({ key: 'seeded', value: false });
    tx.objectStore('meta').put({ key: 'schemaVersion', value: DB_VERSION });
    await transactionToPromise(tx);
  }
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, {
    user: null,
    products: [],
    stores: [],
    cart: [],
    scanCart: [],
    scanMarket: '',
    transactions: [],
    funds: createDefaultFunds(),
    removedFundTypes: [],
    settings: {
      theme: 'light',
      cartAdditionalCharges: 0,
      scanAdditionalCharges: 0,
      aiBudgeting: { enabled: false, provider: 'openrouter', model: '' }
    }
  });
}

export function isUsingIndexedDb() {
  return usingIndexedDb;
}

export async function getPersistenceDebugInfo() {
  const info = { schemaVersion: DB_VERSION, seeded: false, counts: {}, writes: [] };
  if (usingIndexedDb) {
    try {
      info.seeded = Boolean((await readStore('seeded', 'meta'))?.value);
      info.schemaVersion = (await readStore('schemaVersion', 'meta'))?.value || DB_VERSION;
      info.writes = (await readStore('lastWrites', 'meta'))?.value || [];
    } catch (_) { /* ignore */ }
  }
  const data = snapshot(state);
  info.counts = {
    products: data.products.length,
    stores: data.stores.length,
    cart: data.cart.length,
    scanCart: data.scanCart.length,
    transactions: data.transactions.length,
    funds: data.funds.length
  };
  return info;
}

export function getLocalStorageData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export { DEFAULT_STORES };

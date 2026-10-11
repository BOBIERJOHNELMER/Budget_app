import { state, DEFAULT_STORES, createDefaultFunds, formatMoney, moneyToCents, applyAutomaticCashIn, getHighestBalanceSeen } from './state.js';
import { initStorage, persistState, loadState, getLocalStorageData } from './storage.js';
import { initRouter, renderRoute, setHash } from './router.js';
import { showToast, showWelcomeNotification } from './ui/toast.js';
import { openModal } from './ui/modal.js';

const defaultProducts = [
  { id: 'p1', name: 'Rice', price: 5500, store: 'SM Supermarket', type: 'Grocery', photo: '', createdAt: new Date().toISOString() },
  { id: 'p2', name: 'Banana', price: 1200, store: 'Puregold', type: 'Grocery', photo: '', createdAt: new Date().toISOString() },
  { id: 'p3', name: 'Coke', price: 1800, store: 'Robinsons', type: 'Grocery', photo: '', createdAt: new Date().toISOString() },
  { id: 'p4', name: 'Toothpaste', price: 2200, store: 'Mercury Drug', type: 'Medicine', photo: '', createdAt: new Date().toISOString() },
  { id: 'p5', name: 'Paracetamol', price: 1600, store: 'Mercury Drug', type: 'Medicine', photo: '', createdAt: new Date().toISOString() },
  { id: 'p6', name: 'T-shirt', price: 49900, store: 'Uniqlo', type: 'Merchandise', photo: '', createdAt: new Date().toISOString() },
  { id: 'p7', name: 'USB Cable', price: 3500, store: 'SM Supermarket', type: 'Merchandise', photo: '', createdAt: new Date().toISOString() },
  { id: 'p8', name: 'Lampshade', price: 12900, store: 'Ace Hardware', type: 'Merchandise', photo: '', createdAt: new Date().toISOString() },
  { id: 'p9', name: 'Eggs', price: 9800, store: 'Puregold', type: 'Grocery', photo: '', createdAt: new Date().toISOString() },
  { id: 'p10', name: 'Instant Noodles', price: 2400, store: 'SM Supermarket', type: 'Grocery', photo: '', createdAt: new Date().toISOString() },
  { id: 'p11', name: 'Vitamin C', price: 3980, store: 'Watsons', type: 'Medicine', photo: '', createdAt: new Date().toISOString() },
  { id: 'p12', name: 'Storage Box', price: 6900, store: 'Ace Hardware', type: 'Merchandise', photo: '', createdAt: new Date().toISOString() }
];

// Seed only when there is truly no existing data anywhere.
// This writes the seed AND the seeded:true flag in one atomic transaction.
async function seedInitialData() {
  state.stores = [...DEFAULT_STORES];
  state.products = defaultProducts.map((p) => ({ ...p }));
  state.transactions = [];
  state.funds = createDefaultFunds();
  state.removedFundTypes = [];
  state.cart = [];
  state.scanCart = [];
  state.scanMarket = state.stores[0] || '';
  state.settings = { theme: 'light' };
  // persistState writes seeded:true inside putSnapshotTransaction
  await persistState();
}

function hasLowSalaryBalance() {
  if (!state.user) return false;
  const highestBalance = getHighestBalanceSeen();
  return state.user.salaryBalance <= 0
    || state.user.salaryBalance < Math.max(0, highestBalance * 0.1);
}

function normalizeLoadedState() {
  if (!Array.isArray(state.products)) state.products = [];
  if (!Array.isArray(state.stores)) state.stores = [];
  if (!Array.isArray(state.transactions)) state.transactions = [];
  if (!Array.isArray(state.funds)) state.funds = [];
  if (!Array.isArray(state.removedFundTypes)) state.removedFundTypes = [];
  state.funds = state.funds.filter(Boolean).map((fund) => ({
    ...fund,
    balance: Math.max(0, Number(fund.balance) || 0)
  }));
  createDefaultFunds().forEach((defaultFund) => {
    if (!state.removedFundTypes.includes(defaultFund.type)
      && !state.funds.some((fund) => fund.type === defaultFund.type)) state.funds.push(defaultFund);
  });
  if (!Array.isArray(state.cart)) state.cart = [];
  if (!Array.isArray(state.scanCart)) state.scanCart = [];
  if (!state.settings) state.settings = { theme: 'light' };
  if (state.user) {
    if (!state.user.shopBudget) state.user.shopBudget = { enabled: false, limit: 0, spent: 0 };
    if (!state.user.automaticCashIn) state.user.automaticCashIn = { enabled: false, amount: 0, day: 1, lastApplied: '' };
  }
  state.scanCart = state.scanCart.filter((item) => item && item.name).map((item) => ({
    ...item,
    id: item.id || item.productId || `scan_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    price: Number(item.price) || 0,
    qty: Math.max(1, Number(item.qty) || 1),
    saveToShop: Boolean(item.saveToShop),
    store: item.store || '',
    type: item.type || ''
  }));
  if (!state.scanMarket || !state.stores.includes(state.scanMarket)) state.scanMarket = state.stores[0] || '';
  const legacyScanItems = state.cart.filter((item) => item.source === 'scan');
  if (legacyScanItems.length) {
    state.scanCart.push(...legacyScanItems.map((item) => ({ ...item, id: item.productId })));
    state.cart = state.cart.filter((item) => item.source !== 'scan');
  }
}

function bindBottomNav() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      const route = button.dataset.route;
      if (route) window.location.hash = route;
    });
  });
}

function bindThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const sunIcon = '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>';
  const moonIcon = '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" /></svg>';
  const applyTheme = (theme) => {
    document.body.classList.toggle('dark', theme === 'dark');
    state.settings.theme = theme;
    toggle.innerHTML = theme === 'dark' ? moonIcon : sunIcon;
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  };
  applyTheme(state.settings.theme || 'light');
  toggle.addEventListener('click', async () => {
    applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
    await persistState();
  });
}

function showOnboarding() {
  const template = `
    <form id="onboarding-form" class="form-grid">
      <div class="input-group">
        <label for="onboarding-name">Name</label>
        <input id="onboarding-name" name="name" type="text" required />
        <div class="form-error" data-error="name"></div>
      </div>
      <div class="input-group">
        <label for="onboarding-age">Age</label>
        <input id="onboarding-age" name="age" type="number" min="1" max="120" required />
        <div class="form-error" data-error="age"></div>
      </div>
      <div class="input-group">
        <label for="onboarding-salary">Salary balance</label>
        <input id="onboarding-salary" name="salary" type="number" min="0" step="0.01" required />
        <div class="form-error" data-error="salary"></div>
      </div>
      <button class="primary-btn" type="submit">Start budgeting</button>
    </form>
  `;

  const modal = openModal(template, 'Welcome to SalaryWise');
  const form = modal.querySelector('#onboarding-form');

  const setError = (field, message) => {
    const element = modal.querySelector(`[data-error="${field}"]`);
    if (element) element.textContent = message || '';
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = modal.querySelector('#onboarding-name').value.trim();
    const age = Number(modal.querySelector('#onboarding-age').value);
    const salary = Number(modal.querySelector('#onboarding-salary').value);

    setError('name', name ? '' : 'Name is required.');
    setError('age', Number.isInteger(age) && age >= 1 && age <= 120 ? '' : 'Age must be between 1 and 120.');
    setError('salary', Number.isFinite(salary) && salary >= 0 ? '' : 'Salary must be zero or greater.');

    if (!name || !Number.isInteger(age) || age < 1 || age > 120 || !Number.isFinite(salary) || salary < 0) return;

    state.user = {
      name,
      age,
      salaryBalance: Math.round(salary * 100),
      shopBudget: { enabled: false, limit: 0, spent: 0 },
      automaticCashIn: { enabled: false, amount: 0, day: 1, lastApplied: '' },
      createdAt: new Date().toISOString()
    };

    try {
      await persistState();
    } catch (error) {
      state.user = null;
      showToast('Unable to save your profile. Please try again.', 'error');
      return;
    }
    modal.remove();
    if (window.location.hash === '#/dashboard') renderRoute();
    else setHash('#/dashboard');
    showWelcomeNotification(name, hasLowSalaryBalance());
  });
}

let appInitialized = false;

async function initApp() {
  // Guard against double-init (deviceready + DOMContentLoaded both fire on Android)
  if (appInitialized) return;
  appInitialized = true;

  document.getElementById('page-root').innerHTML = '<div class="loading-state">Loading your saved SalaryWise data...</div>';

  await initStorage();

  // Load from IndexedDB (with localStorage fallback inside loadState)
  const persistedState = await loadState();

  if (!persistedState) {
    // Truly no data anywhere — check localStorage one more time as a last resort
    // (loadState already does this, but be explicit for clarity)
    const lsData = getLocalStorageData();
    if (lsData && (lsData.user || (Array.isArray(lsData.products) && lsData.products.length))) {
      // localStorage has data that IndexedDB missed — apply and re-persist to IndexedDB
      Object.assign(state, {
        user: lsData.user || null,
        products: Array.isArray(lsData.products) ? lsData.products : [],
        stores: Array.isArray(lsData.stores) ? lsData.stores : [...DEFAULT_STORES],
        cart: Array.isArray(lsData.cart) ? lsData.cart : [],
        scanCart: Array.isArray(lsData.scanCart) ? lsData.scanCart : [],
        scanMarket: lsData.scanMarket || '',
        transactions: Array.isArray(lsData.transactions) ? lsData.transactions : [],
        funds: Array.isArray(lsData.funds) ? lsData.funds : createDefaultFunds(),
        removedFundTypes: Array.isArray(lsData.removedFundTypes) ? lsData.removedFundTypes : [],
        settings: lsData.settings || { theme: 'light' }
      });
      normalizeLoadedState();
      await persistState();
    } else {
      // Genuinely first launch — seed demo data and persist with seeded flag
      await seedInitialData();
    }
  } else {
    normalizeLoadedState();
    // Do NOT call persistState() here — we loaded existing data, no need to re-write it.
    // Persist structural migrations for legacy scan items and new fund records.
    const hadLegacyScan = persistedState.cart && persistedState.cart.some((item) => item.source === 'scan');
    const hadFundData = Array.isArray(persistedState.funds)
      && Array.isArray(persistedState.removedFundTypes)
      && createDefaultFunds().every((fund) => persistedState.removedFundTypes.includes(fund.type)
        || persistedState.funds.some((existing) => existing.type === fund.type));
    if (hadLegacyScan || !hadFundData) await persistState();
  }

  const cashInApplied = applyAutomaticCashIn();
  if (cashInApplied) {
    try {
      await persistState();
    } catch (error) {
      console.warn('Auto cash-in persist failed', error);
    }
  }

  if (!state.user) showOnboarding();

  bindBottomNav();
  bindThemeToggle();

  if (!window.location.hash || !window.location.hash.startsWith('#/')) {
    window.location.hash = '#/dashboard';
  }
  initRouter();
  if (state.user) {
    showWelcomeNotification(state.user.name, hasLowSalaryBalance());
  }
}

document.addEventListener('deviceready', initApp, false);
window.addEventListener('DOMContentLoaded', initApp);

window.addEventListener('backbutton', () => {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot && modalRoot.querySelector('.modal-backdrop')) {
    modalRoot.innerHTML = '';
    return;
  }
  if (window.location.hash && window.location.hash !== '#/dashboard') {
    window.location.hash = '#/dashboard';
    return;
  }
  const lastExit = window.__lastExitTime || 0;
  if (Date.now() - lastExit > 1500) {
    showToast('Press again to exit');
    window.__lastExitTime = Date.now();
    return;
  }
  navigator.app && navigator.app.exitApp ? navigator.app.exitApp() : window.close();
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash || '#/dashboard';
  const allowed = ['#/dashboard', '#/shop', '#/cart', '#/scan', '#/profile', '#/ai-budgeting'];
  const isFundRoute = /^#\/fund\/[a-zA-Z0-9_-]+$/.test(hash);
  if (!allowed.includes(hash) && !isFundRoute) window.location.hash = '#/dashboard';
});

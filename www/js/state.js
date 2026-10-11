export const CURRENCY_SYMBOL = '₱';
export const CURRENCY_CODE = 'PHP';
export const DEFAULT_STORES = ['SM Supermarket', 'Puregold', 'Robinsons', 'Mercury Drug', 'Watsons', 'Ace Hardware', 'Uniqlo'];
export const PRODUCT_TYPES = ['Grocery', 'Merchandise', 'Medicine'];
export const DEFAULT_FUNDS = [
  { id: 'emergency-funds', name: 'Emergency Funds', type: 'emergency', balance: 0 },
  { id: 'savings', name: 'Savings', type: 'savings', balance: 0 }
];
export const SUBTYPE_MAP = {
  Grocery: ['Food', 'Drinks'],
  Merchandise: ['Clothes', 'Tech Devices', 'Housewares'],
  Medicine: ['Drugs']
};

export const state = {
  user: null,
  products: [],
  cart: [],
  scanCart: [],
  scanMarket: '',
  transactions: [],
  funds: createDefaultFunds(),
  removedFundTypes: [],
  // Start empty — populated by loadState() or seedInitialData(), never pre-seeded at module load
  stores: [],
  route: '#/dashboard',
  settings: {
    theme: 'light',
    cartAdditionalCharges: 0,
    scanAdditionalCharges: 0,
    aiBudgeting: { enabled: false, provider: 'openrouter', model: '' }
  }
};

export function createDefaultFunds() {
  return DEFAULT_FUNDS.map((fund) => ({ ...fund }));
}

export function formatMoney(cents) {
  if (!Number.isFinite(cents)) return `${CURRENCY_SYMBOL}0.00`;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const decimal = abs % 100;
  const formatted = `${whole.toLocaleString('en-PH')}.${String(decimal).padStart(2, '0')}`;
  return `${CURRENCY_SYMBOL}${formatted}`;
}

export function moneyToCents(value) {
  const numeric = Number(String(value ?? '0').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

export function centsToInput(cents) {
  return (cents / 100).toFixed(2);
}

export function sanitizeText(value) {
  return String(value ?? '').replace(/[<>]/g, '');
}

export function asBase64Photo(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return dataUrl || '';
  const clean = dataUrl.split(',')[1] || '';
  return clean;
}

export function getProductById(productId) {
  return state.products.find((product) => product.id === productId) || null;
}

export function getCartCount() {
  return state.cart.reduce((total, item) => total + item.qty, 0);
}

export function isItemInCart(productId) {
  return state.cart.some((item) => item.productId === productId);
}

export function addStore(name) {
  const clean = sanitizeText(name).trim();
  if (!clean) return null;
  if (!state.stores.includes(clean)) {
    state.stores.push(clean);
  }
  return clean;
}

export function addToCart(product, qty = 1, source = 'shop') {
  const existing = state.cart.find((item) => item.productId === product.id && item.source === source);
  if (existing) {
    existing.qty += qty;
    return existing;
  }

  const entry = {
    productId: product.id,
    name: product.name,
    photo: product.photo || '',
    store: product.store,
    type: product.type,
    price: Number(product.price) || 0,
    qty,
    source
  };

  state.cart.push(entry);
  return entry;
}

export function updateCartQty(productId, source, newQty) {
  const target = state.cart.find((item) => item.productId === productId && item.source === source);
  if (!target) return null;
  if (newQty <= 0) {
    state.cart = state.cart.filter((item) => !(item.productId === productId && item.source === source));
    return null;
  }
  target.qty = newQty;
  return target;
}

export function clearCart() {
  state.cart = [];
}

export function getCartTotal() {
  return state.cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty)), 0);
}

export function getAdditionalCharges(cartType) {
  const setting = cartType === 'scan' ? 'scanAdditionalCharges' : 'cartAdditionalCharges';
  return Math.max(0, Number(state.settings?.[setting]) || 0);
}

export function getShopBudget() {
  const budget = state.user?.shopBudget;
  if (!budget || !budget.enabled) return null;
  return {
    enabled: true,
    limit: Math.max(0, Number(budget.limit) || 0),
    spent: Math.max(0, Number(budget.spent) || 0)
  };
}

export function getShopCartTotal() {
  return state.cart.reduce((sum, item) => {
    return item.source === 'shop' ? sum + (Number(item.price) * Number(item.qty)) : sum;
  }, 0);
}

export function getShopBudgetRemaining() {
  const budget = getShopBudget();
  if (!budget) return Number.POSITIVE_INFINITY;
  return Math.max(0, budget.limit - budget.spent - getShopCartTotal() - getAdditionalCharges('shop'));
}

export function canAddToShopCart(price, qty = 1, additionalCharges = getAdditionalCharges('shop')) {
  const budget = getShopBudget();
  if (!budget) return true;
  const remainingWithoutCharges = Math.max(0, budget.limit - budget.spent - getShopCartTotal());
  return Number(price) * Number(qty) + additionalCharges <= remainingWithoutCharges;
}

export function getUserBalance() {
  return Number(state.user?.salaryBalance || 0);
}

export function applyAutomaticCashIn() {
  const cashIn = state.user?.automaticCashIn;
  if (!cashIn?.enabled) return false;

  const amount = Math.max(0, Number(cashIn.amount) || 0);
  const day = Math.min(31, Math.max(1, Number(cashIn.day) || 1));
  if (!amount) return false;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const effectiveDay = Math.min(day, lastDay);
  if (now.getDate() < effectiveDay || cashIn.lastApplied === monthKey) return false;

  const before = Number(state.user.salaryBalance || 0);
  const after = before + amount;
  state.user.salaryBalance = after;
  state.user.automaticCashIn = { enabled: true, amount, day, lastApplied: monthKey };
  state.transactions.unshift({
    id: `cashin_${Date.now()}`,
    timestamp: now.toISOString(),
    total: amount,
    items: [{ name: 'Automatic monthly salary', price: amount, qty: 1, store: 'SalaryWise', type: 'Grocery', photo: '', source: 'automatic-cashin' }],
    balanceBefore: before,
    balanceAfter: after
  });
  return true;
}

export function getHighestBalanceSeen() {
  const transactions = state.transactions || [];
  if (!state.user) return 0;
  const values = [Number(state.user.salaryBalance || 0), ...transactions.map((tx) => Number(tx.balanceAfter || 0)), ...transactions.map((tx) => Number(tx.balanceBefore || 0))];
  return Math.max(0, ...values);
}

export function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function formatDate(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getCartBadge() {
  return getCartCount() > 0 ? String(getCartCount()) : '';
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

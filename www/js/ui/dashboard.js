import { state, escapeHtml, formatMoney, getCartCount, formatDateTime } from '../state.js';
import { renderRoute, setHash } from '../router.js';
import { openCreateFundForm, openSpendingForm } from './allocations.js';

function getMonthlyTotals() {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const list = (state.transactions || []).filter((transaction) => {
    const d = new Date(transaction.timestamp);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });
  const spending = list.filter((transaction) => !['fund-transfer', 'fund-removal'].includes(transaction.kind)
    && !(transaction.items || []).some((item) => item.source === 'automatic-cashin' || item.source === 'adjustment'));
  const totalSpent = spending.reduce((sum, tx) => sum + Number(tx.total || 0), 0);
  const checkoutCount = spending.filter((transaction) => !['manual-expense', 'fund-expense'].includes(transaction.kind)).length;
  return { totalSpent, count: checkoutCount, transactions: spending.slice(0, 3) };
}

function getTypeTotals() {
  const totals = { Grocery: 0, Merchandise: 0, Medicine: 0 };
  (state.transactions || []).forEach((tx) => {
    if (['fund-transfer', 'fund-removal'].includes(tx.kind)
      || (tx.items || []).some((item) => item.source === 'automatic-cashin' || item.source === 'adjustment')) return;
    const items = tx.items || [];
    items.forEach((item) => {
      totals[item.type] = (totals[item.type] || 0) + Number(item.price) * Number(item.qty);
    });
  });
  return totals;
}

export function renderDashboardPage(target) {
  if (!state.user) {
    target.innerHTML = '<div class="empty-state">No user profile data found.</div>';
    return;
  }
  const { totalSpent, count, transactions } = getMonthlyTotals();
  const typeTotals = getTypeTotals();
  const maxType = Math.max(1, ...Object.values(typeTotals));
  const bars = Object.entries(typeTotals).map(([type, total]) => {
    const height = Math.max(18, (total / maxType) * 100);
    const label = type === 'Grocery' ? 'Grocery' : type === 'Merchandise' ? 'Merchandise' : 'Medicine';
    return `
      <div class="bar-group">
        <div class="bar-shell">
          <div class="bar" style="height:${height}%"></div>
        </div>
        <span class="bar-label">${label}</span>
      </div>
    `;
  }).join('');

  const transactionRows = (transactions.length ? transactions : []).slice(0, 3).map((tx) => `
    <button class="card" style="padding: 12px; width: 100%; text-align: left;" data-open-log>
      <div class="row" style="justify-content: space-between;">
        <strong>${formatDateTime(tx.timestamp)}</strong>
        <span>${formatMoney(Number(tx.total || 0))}</span>
      </div>
      <div class="row" style="margin-top: 8px; justify-content: space-between;">
        <span class="tag">${(tx.items || []).length} items</span>
        <span class="tag">${tx.id.slice(-6)}</span>
      </div>
    </button>
  `).join('');

  target.innerHTML = `
    <div class="page">
      <section class="card balance-card">
        <div style="margin-top: 18px;">
          <div class="balance-spending-row">
            <div>
              <div class="balance-label">Current salary balance</div>
              <div class="big-balance">${formatMoney(Number(state.user.salaryBalance || 0))}</div>
            </div>
            <div class="balance-actions">
              <button type="button" class="balance-spending-button" data-open-ai-agent>AI Budgeting Agent</button>
              <button type="button" class="balance-spending-button" data-open-spending>User Spending</button>
            </div>
          </div>
        </div>
      </section>

      <div class="summary-grid" style="margin-top: 16px;">
        <div class="summary-card">
          <div class="eyebrow">Spent this month</div>
          <div class="summary-value">${formatMoney(totalSpent)}</div>
        </div>
        <div class="summary-card">
          <div class="eyebrow">Checkouts</div>
          <div class="summary-value">${count}</div>
        </div>
        <div class="summary-card">
          <div class="eyebrow">Cart</div>
          <div class="summary-value">${getCartCount()}</div>
        </div>
      </div>

      <section class="card allocation-shortcuts" aria-label="Salary portions">
        <div class="page-header">
          <div>
            <h3>Salary portions</h3>
            <p class="shop-budget-note">Separate savings from money available to spend.</p>
          </div>
          <button class="secondary-btn" data-create-fund>Create fund</button>
        </div>
        <div class="allocation-fund-grid">
          ${state.funds.map((fund) => `
            <button class="allocation-fund-button" data-fund-link="${fund.id}">
              <span>${escapeHtml(fund.name)}</span>
              <strong>${formatMoney(Number(fund.balance || 0))}</strong>
              <small>Open fund</small>
            </button>
          `).join('')}
        </div>
      </section>

      <div class="card" style="margin-top: 16px;">
        <div class="page-header">
          <h3>Spending by type</h3>
        </div>
        <div class="chart-wrap">${bars}</div>
        <div class="legend">
          ${Object.entries(typeTotals).map(([type, total]) => `
            <span class="tag"><span class="dot"></span>${type} ${formatMoney(total)}</span>
          `).join('')}
        </div>
      </div>

      <div class="card" style="margin-top: 16px;">
        <div class="page-header">
          <h3>Recent transactions</h3>
        </div>
        <div class="list-stack">${transactionRows || '<div class="empty-state">No spending activity yet.</div>'}</div>
      </div>

      <div class="button-row" style="margin-top: 18px;">
        <button class="primary-btn" data-link="#/shop">Shop</button>
        <button class="secondary-btn" data-link="#/scan">Scan Shelf Price</button>
        <button class="ghost-btn" data-link="#/cart">View Cart ${getCartCount() ? `<span class="tag">${getCartCount()}</span>` : ''}</button>
      </div>
    </div>
  `;

  target.querySelectorAll('[data-link]').forEach((button) => {
    button.addEventListener('click', () => setHash(button.dataset.link));
  });

  target.querySelectorAll('[data-fund-link]').forEach((button) => {
    button.addEventListener('click', () => setHash(`#/fund/${button.dataset.fundLink}`));
  });

  target.querySelector('[data-create-fund]').addEventListener('click', () => {
    openCreateFundForm(() => renderRoute());
  });

  target.querySelector('[data-open-spending]').addEventListener('click', () => {
    openSpendingForm(() => renderRoute());
  });

  target.querySelector('[data-open-ai-agent]').addEventListener('click', () => setHash('#/ai-budgeting'));

  target.querySelectorAll('[data-open-log]').forEach((button) => {
    button.addEventListener('click', () => setHash('#/profile'));
  });
}

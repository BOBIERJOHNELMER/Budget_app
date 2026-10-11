import { state, escapeHtml, formatMoney, formatDateTime, sanitizeText, moneyToCents } from '../state.js';
import { persistState, resetAllData, getPersistenceDebugInfo } from '../storage.js';
import { setHash } from '../router.js';
import { showToast } from './toast.js';
import { openModal, confirmAction } from './modal.js';
import { saveReceiptFile, openReceiptFile } from '../receipt.js';
import { openAiPrivileges } from './ai-budgeting.js';

function renderTransactionRow(transaction) {
  const items = (transaction.items || []).map((item) => `
    <li class="row" style="justify-content: space-between; border-top: 1px solid var(--border); padding-top: 8px;">
      <div class="row" style="gap: 10px;">
        <img src="${item.photo || ''}" alt="${sanitizeText(item.name)}" />
        <div>
          <div><strong>${sanitizeText(item.name)}</strong></div>
          <div>${sanitizeText(item.store)} • ${sanitizeText(item.type)}</div>
        </div>
      </div>
      <div style="text-align: right;">
        <div>${item.qty}× ${formatMoney(Number(item.price))}</div>
        <div>${formatMoney(Number(item.price) * Number(item.qty))}</div>
      </div>
    </li>
  `).join('');
  const manualExpense = transaction.kind === 'manual-expense';
  const fundExpense = transaction.kind === 'fund-expense';
  const internalTransfer = transaction.kind === 'fund-transfer' || transaction.kind === 'fund-removal';
  const summary = manualExpense
    ? `User spending • ${escapeHtml(transaction.reason || '')} • ${formatMoney(Number(transaction.total || 0))}`
    : fundExpense
      ? `${escapeHtml(transaction.fundName || 'Fund')} • ${escapeHtml(transaction.reason || '')} • ${formatMoney(Number(transaction.total || 0))}`
      : internalTransfer
        ? `${escapeHtml(transaction.from || '')} → ${escapeHtml(transaction.to || '')} • ${formatMoney(Number(transaction.total || 0))}`
      : `${(transaction.items || []).length} items • ${formatMoney(Number(transaction.total || 0))}`;
  const beforeLabel = fundExpense ? 'Fund balance before' : 'Balance before';
  const afterLabel = fundExpense ? 'Fund balance after' : 'Balance after';
  const beforeBalance = fundExpense ? transaction.fundBalanceBefore : transaction.balanceBefore;
  const afterBalance = fundExpense ? transaction.fundBalanceAfter : transaction.balanceAfter;
  const expenseDetails = (manualExpense || fundExpense)
    ? `<div class="transaction-reason"><strong>Reason:</strong> ${escapeHtml(transaction.reason || '')}</div>`
    : '';
  const additionalCharges = Number(transaction.additionalCharges || 0) > 0
    ? `<div class="row" style="justify-content: space-between; margin-bottom: 10px;"><span>Additional charges</span><strong>${formatMoney(Number(transaction.additionalCharges))}</strong></div>`
    : '';
  const balanceRows = `
    <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
      <span>${beforeLabel}</span>
      <strong>${formatMoney(Number(beforeBalance || 0))}</strong>
    </div>
    <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
      <span>${afterLabel}</span>
      <strong>${formatMoney(Number(afterBalance || 0))}</strong>
    </div>
  `;
  const transferBalances = internalTransfer ? `
    <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
      <span>${escapeHtml(transaction.from)} balance</span>
      <strong>${formatMoney(Number(transaction.sourceBalanceBefore || 0))} → ${formatMoney(Number(transaction.sourceBalanceAfter || 0))}</strong>
    </div>
    <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
      <span>${escapeHtml(transaction.to)} balance</span>
      <strong>${formatMoney(Number(transaction.destinationBalanceBefore || 0))} → ${formatMoney(Number(transaction.destinationBalanceAfter || 0))}</strong>
    </div>
  ` : '';

  return `
    <div class="transaction-item">
      <button class="accordion-header" data-toggle-transaction="${transaction.id}">
        <span>
          <strong>${formatDateTime(transaction.timestamp)}</strong><br />
          <small>${summary}</small>
        </span>
        <span>▾</span>
      </button>
      <div class="accordion-body hidden" data-transaction-body="${transaction.id}">
        ${balanceRows}
        ${transferBalances}
        ${additionalCharges}
        ${expenseDetails}
        ${items ? `<ul class="transaction-row">${items}</ul>` : ''}
        ${internalTransfer ? `<div class="transaction-reason">${transaction.kind === 'fund-removal' ? 'Salary portion removed and balance returned to salary.' : escapeHtml(transaction.reason || 'Internal balance transfer')}</div>` : ''}
        <div class="button-row" style="margin-top: 12px; justify-content: flex-end;">
          ${!manualExpense && !fundExpense && !internalTransfer ? `<button class="secondary-btn" data-receipt-download="${transaction.id}">Download receipt again</button>` : ''}
          ${!internalTransfer ? `<button class="danger-btn" data-revert-transaction="${transaction.id}">Revert</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

export function renderProfilePage(target) {
  const user = state.user;
  const tracked = state.transactions || [];

  const filters = [
    { label: 'All', value: 'all' },
    { label: 'This week', value: 'week' },
    { label: 'This month', value: 'month' }
  ];

  const filterValue = window.__profileFilter || 'all';
  const visibleTransactions = tracked.filter((transaction) => {
    const date = new Date(transaction.timestamp);
    const now = new Date();
    const diffDays = (now - date) / (1000 * 60 * 60 * 24);
    if (filterValue === 'week') return diffDays <= 7;
    if (filterValue === 'month') return diffDays <= 30;
    return true;
  });

  target.innerHTML = `
    <div class="page">
      <div class="card">
        <h2>Profile</h2>
        <button type="button" class="version-mark" data-version-tap aria-label="App version">v1.0.0</button>
        <div class="form-grid">
          <div class="input-group">
            <label>Name</label>
            <div>${sanitizeText(user?.name || '')}</div>
          </div>
          <div class="input-group">
            <label>Age</label>
            <div>${user?.age ?? ''}</div>
          </div>
          <div class="input-group">
            <label>Salary balance</label>
            <div>${formatMoney(Number(user?.salaryBalance || 0))}</div>
          </div>
        </div>
        <div class="button-row" style="margin-top: 12px;">
          <button class="primary-btn" data-edit-profile>Edit profile</button>
          <button class="secondary-btn" data-open-ai-agent>AI Budgeting Agent</button>
        </div>
      </div>

      <div class="card" style="margin-top: 16px;">
        <div class="page-header">
          <h3>Transaction logs</h3>
        </div>
        <div class="filter-row">
          ${filters.map((filter) => `<button class="chip ${filterValue === filter.value ? 'active' : ''}" data-range="${filter.value}">${filter.label}</button>`).join('')}
        </div>
        <div class="list-stack transaction-log-list" style="margin-top: 14px;" role="region" aria-label="Transaction log entries" tabindex="0">
          ${visibleTransactions.length ? visibleTransactions.map(renderTransactionRow).join('') : '<div class="empty-state">No transactions in this range.</div>'}
        </div>
      </div>
      <div class="card settings-card">
        <div class="page-header">
          <div>
            <h3>Settings</h3>
            <p class="shop-budget-note">Salary, automatic cash-in, and markets</p>
          </div>
          <button class="secondary-btn" data-open-settings>Open settings</button>
        </div>
      </div>
    </div>
  `;

  target.querySelectorAll('[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      window.__profileFilter = button.dataset.range;
      renderProfilePage(target);
    });
  });

  target.querySelector('[data-edit-profile]').addEventListener('click', () => openEditProfileForm());
  target.querySelector('[data-open-ai-agent]').addEventListener('click', () => setHash('#/ai-budgeting'));
  target.querySelector('[data-open-settings]').addEventListener('click', () => openSettingsForm(target));
  let versionTaps = 0;
  target.querySelector('[data-version-tap]').addEventListener('click', async () => {
    versionTaps += 1;
    if (versionTaps >= 5) await openPersistenceDebugPanel();
  });

  target.querySelectorAll('[data-toggle-transaction]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.toggleTransaction;
      const body = target.querySelector(`[data-transaction-body="${id}"]`);
      if (body) body.classList.toggle('hidden');
    });
  });

  target.querySelectorAll('[data-receipt-download]').forEach((button) => {
    button.addEventListener('click', async () => {
      const transaction = state.transactions.find((item) => item.id === button.dataset.receiptDownload);
      if (!transaction) return;
      try {
        const record = await saveReceiptFile(transaction);
        if (record && record.path) {
          await openReceiptFile(record);
        } else {
          showToast('Unable to create the PDF receipt.', 'error');
        }
      } catch (error) {
        showToast(error.message || 'Unable to download the PDF receipt.', 'error');
      }
    });
  });

  target.querySelectorAll('[data-revert-transaction]').forEach((button) => {
    button.addEventListener('click', async () => {
      const transaction = state.transactions.find((item) => item.id === button.dataset.revertTransaction);
      if (!transaction) {
        showToast('This transaction is no longer available.', 'error');
        return;
      }
      const total = Number(transaction.total || 0);
      const isFundExpense = transaction.kind === 'fund-expense';
      const destination = isFundExpense ? 'the fund balance' : 'your salary balance';
      confirmAction('Revert this transaction?', `₱${(total / 100).toFixed(2)} will be returned to ${destination} and the log will be deleted.`, async () => {
        const current = state.transactions.find((item) => item.id === transaction.id);
        if (!current) {
          showToast('This transaction was already reverted.', 'error');
          return;
        }
        let nextUser = state.user;
        let nextFunds = state.funds;
        if (current.kind === 'fund-expense') {
          const fund = state.funds.find((item) => item.id === current.fundId);
          if (!fund) {
            showToast('The original fund could not be found, so this transaction cannot be reverted.', 'error');
            return;
          }
          nextFunds = state.funds.map((item) => item.id === fund.id
            ? { ...item, balance: Number(item.balance || 0) + total }
            : item);
        } else {
          nextUser = { ...state.user, salaryBalance: Number(state.user.salaryBalance || 0) + total };
        }
        const nextTransactions = state.transactions.filter((item) => item.id !== transaction.id);
        try {
          await persistState({ ...state, user: nextUser, funds: nextFunds, transactions: nextTransactions });
          renderProfilePage(target);
          showToast('Transaction reverted');
        } catch (error) {
          showToast(error.message || 'Unable to revert this transaction.', 'error');
        }
      });
    });
  });
}

async function openPersistenceDebugPanel() {
  const info = await getPersistenceDebugInfo();
  const modal = openModal(`
    <div class="debug-panel">
      <div><strong>Schema version</strong><span>${info.schemaVersion}</span></div>
      <div><strong>Seeded</strong><span>${info.seeded ? 'true' : 'false'}</span></div>
      <div><strong>Record counts</strong><span>${Object.entries(info.counts).map(([key, value]) => `${key}: ${value}`).join(' | ')}</span></div>
      <h4>Last writes</h4>
      <pre>${JSON.stringify(info.writes, null, 2)}</pre>
    </div>
  `, 'Persistence diagnostics');
  modal?.querySelector('[data-close-modal]')?.focus();
}

function openSettingsForm(target) {
  const currentTheme = state.settings?.theme || 'light';
  const modal = openModal(`
    <div class="form-grid">
      <div class="input-group">
        <label for="settings-theme">Appearance</label>
        <select id="settings-theme">
          <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>Light mode</option>
          <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>Dark mode</option>
        </select>
      </div>
      <div class="settings-section">
        <h4>Budget settings</h4>
        <button type="button" class="secondary-btn" data-open-salary-settings>Salary balance</button>
        <button type="button" class="secondary-btn" data-open-cashin-settings>Automatic monthly cash-in</button>
        <button type="button" class="secondary-btn" data-open-market-settings>Markets</button>
      </div>
      <div class="settings-section">
        <div class="page-header">
          <div>
            <h4>AI budgeting</h4>
            <p class="shop-budget-note">Provider configuration requires AI privileges.</p>
          </div>
          <button type="button" class="secondary-btn" data-ai-privileges>AI privileges</button>
        </div>
      </div>
      <div class="button-row" style="justify-content: flex-end;">
        <button type="button" class="danger-btn" data-reset-all>Reset all data</button>
        <button type="button" class="primary-btn" data-close-settings>Done</button>
      </div>
    </div>
  `, 'Settings');
  if (!modal) return;

  modal.querySelector('[data-close-settings]').addEventListener('click', () => modal.remove());
  modal.querySelector('[data-open-salary-settings]').addEventListener('click', () => openSalarySettings(target));
  modal.querySelector('[data-open-cashin-settings]').addEventListener('click', () => openAutomaticCashInSettings());
  modal.querySelector('[data-open-market-settings]').addEventListener('click', () => openMarketsSettings());
  modal.querySelector('[data-ai-privileges]').addEventListener('click', () => openAiPrivileges());
  modal.querySelector('[data-reset-all]').addEventListener('click', async () => {
    const confirmation = window.prompt('Type RESET to delete all SalaryWise data.');
    if (confirmation !== 'RESET') {
      showToast('Reset cancelled.', 'error');
      return;
    }
    try {
      await resetAllData();
      modal.remove();
      window.location.reload();
    } catch (error) {
      showToast(error.message || 'Unable to reset SalaryWise data.', 'error');
    }
  });
  modal.querySelector('#settings-theme').addEventListener('change', async (event) => {
    const theme = event.currentTarget.value;
    try {
      await persistState({ ...state, settings: { ...state.settings, theme } });
      document.body.classList.toggle('dark', theme === 'dark');
      const themeToggle = document.getElementById('theme-toggle');
      if (themeToggle) {
        themeToggle.innerHTML = theme === 'dark'
          ? '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" /></svg>'
          : '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>';
      }
      showToast('Appearance updated');
    } catch (error) {
      showToast(error.message || 'Unable to save appearance settings.', 'error');
    }
  });
}

function openSalarySettings(target) {
  const modal = openModal(`
    <form class="form-grid" data-salary-settings-form>
      <p class="shop-budget-note">Current salary balance: <strong>${formatMoney(Number(state.user.salaryBalance || 0))}</strong></p>
      <div class="input-group">
        <label for="settings-salary">Amount</label>
        <input id="settings-salary" name="amount" type="number" min="0" step="0.01" placeholder="0.00" required />
      </div>
      <div class="button-row">
        <button type="button" class="secondary-btn" data-add-salary>Add to balance</button>
        <button type="button" class="secondary-btn" data-set-salary>Set balance</button>
      </div>
    </form>
  `, 'Salary balance');
  if (!modal) return;

  const amountInput = modal.querySelector('#settings-salary');
  const updateSalary = async (mode) => {
    const value = Number(amountInput.value);
    if (!Number.isFinite(value) || value < 0 || (mode === 'add' && value === 0)) {
      showToast('Enter a valid salary amount.', 'error');
      return;
    }
    const before = Number(state.user.salaryBalance || 0);
    const amount = moneyToCents(value);
    const after = mode === 'set' ? amount : before + amount;
    const nextUser = { ...state.user, salaryBalance: after };
    const salaryTransaction = {
      id: `salary_${Date.now()}`,
      timestamp: new Date().toISOString(),
      total: Math.abs(after - before),
      items: [{ name: mode === 'set' ? 'Salary balance set' : 'Salary added', price: Math.abs(after - before), qty: 1, store: 'SalaryWise', type: 'Grocery', photo: '', source: 'adjustment' }],
      balanceBefore: before,
      balanceAfter: after
    };
    try {
      await persistState({ ...state, user: nextUser, transactions: [salaryTransaction, ...state.transactions] });
      modal.remove();
      renderProfilePage(target);
      showToast('Salary balance updated');
    } catch (error) {
      showToast(error.message || 'Unable to update salary balance.', 'error');
    }
  };
  modal.querySelector('[data-add-salary]').addEventListener('click', () => updateSalary('add'));
  modal.querySelector('[data-set-salary]').addEventListener('click', () => updateSalary('set'));
}

function openAutomaticCashInSettings() {
  const automaticCashIn = state.user.automaticCashIn || { enabled: false, amount: 0, day: 1, lastApplied: '' };
  const modal = openModal(`
    <form id="cashin-settings-form" class="form-grid" novalidate>
      <label class="row budget-toggle"><input id="settings-cashin-enabled" type="checkbox" ${automaticCashIn.enabled ? 'checked' : ''} /> Add salary automatically every month</label>
      <div class="form-grid settings-inline-fields">
        <div class="input-group">
          <label for="settings-cashin-amount">Amount</label>
          <input id="settings-cashin-amount" type="number" min="0.01" step="0.01" value="${automaticCashIn.amount ? automaticCashIn.amount / 100 : ''}" />
        </div>
        <div class="input-group">
          <label for="settings-cashin-day">Day of month</label>
          <input id="settings-cashin-day" type="number" min="1" max="31" step="1" value="${automaticCashIn.day || 1}" />
        </div>
      </div>
      <div class="form-error" data-cashin-error></div>
      <div class="button-row">
        <button type="button" class="secondary-btn" data-close-cashin>Cancel</button>
        <button type="submit" class="primary-btn">Save cash-in settings</button>
      </div>
    </form>
  `, 'Automatic monthly cash-in');
  if (!modal) return;

  modal.querySelector('[data-close-cashin]').addEventListener('click', () => modal.remove());
  modal.querySelector('#cashin-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const enabled = modal.querySelector('#settings-cashin-enabled').checked;
    const amount = Number(modal.querySelector('#settings-cashin-amount').value);
    const day = Number(modal.querySelector('#settings-cashin-day').value);
    if (enabled && (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(day) || day < 1 || day > 31)) {
      modal.querySelector('[data-cashin-error]').textContent = 'Enter a valid amount and a day from 1 to 31.';
      return;
    }
    try {
      await persistState({
        ...state,
        user: {
          ...state.user,
          automaticCashIn: {
            enabled,
            amount: enabled ? moneyToCents(amount) : 0,
            day: enabled ? day : 1,
            lastApplied: automaticCashIn.lastApplied || ''
          }
        }
      });
      modal.remove();
      showToast('Automatic cash-in settings saved');
    } catch (error) {
      showToast(error.message || 'Unable to save automatic cash-in settings.', 'error');
    }
  });
}

function openMarketsSettings() {
  const modal = openModal(`
    <div class="form-grid">
      <form class="settings-market-form" data-market-form>
        <div class="input-group">
          <label for="settings-market-name">Market name</label>
          <input id="settings-market-name" name="market" maxlength="80" required />
        </div>
        <button type="submit" class="secondary-btn">Add market</button>
      </form>
      <div class="settings-market-list" data-market-list></div>
      <button type="button" class="secondary-btn" data-close-markets>Done</button>
    </div>
  `, 'Markets');
  if (!modal) return;

  const list = modal.querySelector('[data-market-list]');
  const refreshMarkets = () => {
    list.innerHTML = state.stores.map((store) => `
      <div class="settings-market-row">
        <span>${escapeHtml(store)}</span>
        <button type="button" class="danger-btn" data-remove-market="${escapeHtml(store)}">Remove</button>
      </div>
    `).join('') || '<p class="shop-budget-note">No markets have been added.</p>';
  };
  refreshMarkets();
  modal.querySelector('[data-close-markets]').addEventListener('click', () => modal.remove());
  modal.querySelector('[data-market-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = modal.querySelector('#settings-market-name');
    const market = sanitizeText(input.value).trim();
    if (!market) {
      showToast('Enter a market name.', 'error');
      return;
    }
    if (state.stores.includes(market)) {
      showToast('That market already exists.', 'error');
      return;
    }
    try {
      await persistState({ ...state, stores: [...state.stores, market] });
      input.value = '';
      refreshMarkets();
    } catch (error) {
      showToast(error.message || 'Unable to add market.', 'error');
    }
  });
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-market]');
    if (!button) return;
    const market = button.dataset.removeMarket;
    if (state.products.some((product) => product.store === market)) {
      showToast('This market is used by a product and cannot be removed.', 'error');
      return;
    }
    try {
      await persistState({ ...state, stores: state.stores.filter((store) => store !== market) });
      refreshMarkets();
    } catch (error) {
      showToast(error.message || 'Unable to remove market.', 'error');
    }
  });
}

function openEditProfileForm() {
  const formHtml = `
    <form id="profile-edit-form">
      <div class="input-group">
        <label for="edit-name">Name</label>
        <input id="edit-name" value="${sanitizeText(state.user?.name || '')}" required />
      </div>
      <div class="input-group">
        <label for="edit-age">Age</label>
        <input id="edit-age" type="number" min="1" max="120" value="${state.user?.age ?? ''}" required />
      </div>
      <div class="button-row" style="margin-top: 14px; justify-content: flex-end;">
        <button type="button" class="secondary-btn" data-close-profile>Edit Cancel</button>
        <button type="submit" class="primary-btn">Save</button>
      </div>
    </form>
  `;
  const modal = openModal(formHtml, 'Edit profile');
  modal.querySelector('#profile-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = modal.querySelector('#edit-name').value.trim();
    const age = Number(modal.querySelector('#edit-age').value);
    if (!name || age < 1 || age > 120) {
      showToast('Please enter a valid name and age.', 'error');
      return;
    }
    await persistState({ ...state, user: { ...state.user, name, age } });
    modal.remove();
    renderProfilePage(document.getElementById('page-root'));
    showToast('Profile updated');
  });
  modal.querySelector('[data-close-profile]').addEventListener('click', () => modal.remove());
}

function openSalaryAdjustmentForm() {
  const formHtml = `
    <form id="salary-adjust-form">
      <div class="input-group">
        <label for="salary-value">Set / add salary</label>
        <input id="salary-value" type="number" min="0" step="0.01" required />
      </div>
      <div class="button-row" style="margin-top: 14px; justify-content: flex-end;">
        <button type="button" class="secondary-btn" data-close-salary>Cancel</button>
        <button type="submit" class="primary-btn">Confirm</button>
      </div>
    </form>
  `;
  const modal = openModal(formHtml, 'Adjust salary balance');
  modal.querySelector('#salary-adjust-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = Number(modal.querySelector('#salary-value').value);
    if (!Number.isFinite(value) || value < 0) {
      showToast('Enter a valid salary amount.', 'error');
      return;
    }
    const before = Number(state.user.salaryBalance || 0);
    const after = before + moneyToCents(value);
    const nextUser = { ...state.user, salaryBalance: after };
    const salaryTransaction = {
      id: `salary_${Date.now()}`,
      timestamp: new Date().toISOString(),
      total: moneyToCents(value),
      items: [{ name: 'Salary adjustment', price: moneyToCents(value), qty: 1, store: 'SalaryWise', type: 'Grocery', photo: '', source: 'adjustment' }],
      balanceBefore: before,
      balanceAfter: after
    };
    await persistState({ ...state, user: nextUser, transactions: [salaryTransaction, ...state.transactions] });
    modal.remove();
    renderProfilePage(document.getElementById('page-root'));
    showToast('Salary balance updated');
  });
  modal.querySelector('[data-close-salary]').addEventListener('click', () => modal.remove());
}

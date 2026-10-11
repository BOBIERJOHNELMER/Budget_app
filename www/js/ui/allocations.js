import { state, escapeHtml, formatMoney, makeId, moneyToCents, sanitizeText } from '../state.js';
import { persistState } from '../storage.js';
import { setHash } from '../router.js';
import { showToast } from './toast.js';
import { confirmAction, openModal } from './modal.js';

function readAmount(input) {
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return moneyToCents(value);
}

function appendTransaction(transaction) {
  return [transaction, ...(state.transactions || [])];
}

export function openSpendingForm(onSaved) {
  if (!state.user) {
    showToast('Create a profile before recording spending.', 'error');
    return;
  }

  const modal = openModal(`
    <form class="form-grid allocation-form" data-spending-form>
      <p class="allocation-help">Record money spent from your available salary balance.</p>
      <div class="input-group">
        <label for="spending-reason">Reason</label>
        <input id="spending-reason" name="reason" type="text" maxlength="120" required />
      </div>
      <div class="input-group">
        <label for="spending-amount">How much did you spend?</label>
        <input id="spending-amount" name="amount" type="number" min="0.01" step="0.01" required />
      </div>
      <button class="primary-btn" type="submit">Confirm spending</button>
    </form>
  `, 'User Spending');
  if (!modal) return;

  modal.querySelector('[data-spending-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = sanitizeText(form.elements.reason.value).trim();
    const total = readAmount(form.elements.amount);
    const balanceBefore = Number(state.user.salaryBalance || 0);
    if (!reason || !total) {
      showToast('Enter a reason and a valid amount.', 'error');
      return;
    }
    if (total > balanceBefore) {
      showToast('That amount is greater than your available salary balance.', 'error');
      return;
    }

    const transaction = {
      id: makeId('spending'),
      timestamp: new Date().toISOString(),
      kind: 'manual-expense',
      reason,
      total,
      items: [],
      balanceBefore,
      balanceAfter: balanceBefore - total
    };
    try {
      await persistState({
        ...state,
        user: { ...state.user, salaryBalance: balanceBefore - total },
        transactions: appendTransaction(transaction)
      });
      modal.remove();
      onSaved();
      showToast('Spending recorded');
    } catch (error) {
      showToast(error.message || 'Unable to save this spending record.', 'error');
    }
  });
}

export function renderFundPage(target, fundId) {
  const fund = state.funds.find((item) => item.id === fundId);
  if (!state.user || !fund) {
    target.innerHTML = '<div class="empty-state">This fund could not be found.</div>';
    return;
  }

  const fundName = escapeHtml(fund.name);
  target.innerHTML = `
    <div class="page">
      <div class="page-header">
        <button class="secondary-btn" data-back-dashboard>← Dashboard</button>
        <h2>${fundName}</h2>
        <button type="button" class="danger-btn" data-delete-fund>Remove portion</button>
      </div>
      <section class="card allocation-balance-card">
        <span>${fundName} balance</span>
        <strong>${formatMoney(Number(fund.balance || 0))}</strong>
        <small>Available salary balance: ${formatMoney(Number(state.user.salaryBalance || 0))}</small>
        <button type="button" class="primary-btn" data-open-fund-transfer>Move money</button>
      </section>
      <form class="card form-grid allocation-form" data-fund-expense>
        <h3>Record spending from ${fundName}</h3>
        <div class="input-group">
          <label for="fund-expense-reason">Reason</label>
          <input id="fund-expense-reason" name="reason" type="text" maxlength="120" required />
        </div>
        <div class="input-group">
          <label for="fund-expense-amount">How much did you spend?</label>
          <input id="fund-expense-amount" name="amount" type="number" min="0.01" step="0.01" required />
        </div>
        <button class="primary-btn" type="submit">Confirm spending</button>
      </form>
    </div>
  `;

  target.querySelector('[data-back-dashboard]').addEventListener('click', () => setHash('#/dashboard'));
  target.querySelector('[data-delete-fund]').addEventListener('click', () => {
    confirmAction(
      'Remove salary portion',
      `Are you sure you want to remove "${fundName}"? Its ${formatMoney(Number(fund.balance || 0))} balance will move back to your current salary balance.`,
      async () => {
        const balance = Number(fund.balance || 0);
        const nextFunds = state.funds.filter((item) => item.id !== fund.id);
        const nextRemovedFundTypes = fund.type === 'emergency' || fund.type === 'savings'
          ? [...new Set([...state.removedFundTypes, fund.type])]
          : state.removedFundTypes;
        try {
          const transaction = {
            id: makeId('fund-removal'),
            timestamp: new Date().toISOString(),
            kind: 'fund-removal',
            from: fund.name,
            to: 'Current salary balance',
            reason: 'Salary portion removed',
            total: balance,
            items: [],
            balanceBefore: Number(state.user.salaryBalance || 0),
            balanceAfter: Number(state.user.salaryBalance || 0) + balance,
            sourceBalanceBefore: balance,
            sourceBalanceAfter: 0,
            destinationBalanceBefore: Number(state.user.salaryBalance || 0),
            destinationBalanceAfter: Number(state.user.salaryBalance || 0) + balance
          };
          await persistState({
            ...state,
            user: { ...state.user, salaryBalance: Number(state.user.salaryBalance || 0) + balance },
            funds: nextFunds,
            removedFundTypes: nextRemovedFundTypes,
            transactions: appendTransaction(transaction)
          });
          setHash('#/dashboard');
          showToast('Salary portion removed');
        } catch (error) {
          showToast(error.message || 'Unable to remove this salary portion.', 'error');
        }
      }
    );
  });
  target.querySelector('[data-open-fund-transfer]').addEventListener('click', () => {
    openFundTransferForm(fund, () => renderFundPage(target, fund.id));
  });

  target.querySelector('[data-fund-expense]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = sanitizeText(form.elements.reason.value).trim();
    const amount = readAmount(form.elements.amount);
    const fundBalance = Number(fund.balance || 0);
    if (!reason || !amount) {
      showToast('Enter a reason and a valid amount.', 'error');
      return;
    }
    if (amount > fundBalance) {
      showToast('That amount is greater than this fund balance.', 'error');
      return;
    }

    const transaction = {
      id: makeId('fund-expense'),
      timestamp: new Date().toISOString(),
      kind: 'fund-expense',
      fundId: fund.id,
      fundName: fund.name,
      reason,
      total: amount,
      items: [],
      balanceBefore: Number(state.user.salaryBalance || 0),
      balanceAfter: Number(state.user.salaryBalance || 0),
      fundBalanceBefore: fundBalance,
      fundBalanceAfter: fundBalance - amount
    };
    const nextFunds = state.funds.map((item) => item.id === fund.id
      ? { ...item, balance: fundBalance - amount }
      : item);
    try {
      await persistState({
        ...state,
        funds: nextFunds,
        transactions: appendTransaction(transaction)
      });
      renderFundPage(target, fund.id);
      showToast('Fund spending recorded');
    } catch (error) {
      showToast(error.message || 'Unable to save this fund spending record.', 'error');
    }
  });
}

function openFundTransferForm(fund, onSaved) {
  const fundName = escapeHtml(fund.name);
  const modal = openModal(`
    <form class="form-grid allocation-form" data-fund-transfer>
      <p class="allocation-help">This transfers money from your salary balance. It is not recorded as spending.</p>
      <div class="allocation-transfer-balances">
        <span>Current salary balance <strong>${formatMoney(Number(state.user.salaryBalance || 0))}</strong></span>
        <span>Available salary balance <strong>${formatMoney(Number(state.user.salaryBalance || 0))}</strong></span>
        <span>${fundName} balance <strong>${formatMoney(Number(fund.balance || 0))}</strong></span>
      </div>
      <div class="input-group">
        <label for="fund-transfer-amount">Amount to move</label>
        <input id="fund-transfer-amount" name="amount" type="number" min="0.01" step="0.01" required />
      </div>
      <div class="button-row">
        <button class="primary-btn" type="submit">Move to ${fundName}</button>
        <button type="button" class="secondary-btn" data-open-transfer>Transfer</button>
      </div>
    </form>
  `, `Move money into ${fund.name}`);
  if (!modal) return;

  modal.querySelector('[data-open-transfer]').addEventListener('click', () => {
    modal.remove();
    openTransferOutForm(fund, onSaved);
  });

  modal.querySelector('[data-fund-transfer]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = readAmount(event.currentTarget.elements.amount);
    const salaryBalance = Number(state.user.salaryBalance || 0);
    if (!amount) {
      showToast('Enter a valid amount to move.', 'error');
      return;
    }
    if (amount > salaryBalance) {
      showToast('That amount is greater than your available salary balance.', 'error');
      return;
    }

    const nextFunds = state.funds.map((item) => item.id === fund.id
      ? { ...item, balance: Number(item.balance || 0) + amount }
      : item);
    const transaction = {
      id: makeId('fund-transfer'),
      timestamp: new Date().toISOString(),
      kind: 'fund-transfer',
      from: 'Current salary balance',
      to: fund.name,
      reason: 'Salary moved into portion',
      total: amount,
      items: [],
      balanceBefore: salaryBalance,
      balanceAfter: salaryBalance - amount,
      sourceBalanceBefore: salaryBalance,
      sourceBalanceAfter: salaryBalance - amount,
      destinationBalanceBefore: Number(fund.balance || 0),
      destinationBalanceAfter: Number(fund.balance || 0) + amount
    };
    try {
      await persistState({
        ...state,
        user: { ...state.user, salaryBalance: salaryBalance - amount },
        funds: nextFunds,
        transactions: appendTransaction(transaction)
      });
      modal.remove();
      onSaved();
      showToast('Money moved into the fund');
    } catch (error) {
      showToast(error.message || 'Unable to move money into this fund.', 'error');
    }
  });
}

function openTransferOutForm(fund, onSaved) {
  const targets = [
    '<option value="salary">Current salary balance</option>',
    ...state.funds
      .filter((item) => item.id !== fund.id)
      .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
  ].join('');
  const modal = openModal(`
    <form class="form-grid allocation-form" data-fund-transfer-form>
      <p class="allocation-help">Transfer money out of ${escapeHtml(fund.name)}. This is not spending.</p>
      <div class="allocation-transfer-balances">
        <span>${escapeHtml(fund.name)} available <strong>${formatMoney(Number(fund.balance || 0))}</strong></span>
        <span>Current salary balance <strong>${formatMoney(Number(state.user.salaryBalance || 0))}</strong></span>
      </div>
      <div class="input-group">
        <label for="fund-transfer-target">Transfer to</label>
        <select id="fund-transfer-target" name="target" required>${targets}</select>
      </div>
      <div class="input-group">
        <label for="fund-transfer-out-amount">Amount to transfer</label>
        <input id="fund-transfer-out-amount" name="amount" type="number" min="0.01" step="0.01" required />
      </div>
      <button class="primary-btn" type="submit">Confirm transfer</button>
    </form>
  `, `Transfer from ${fund.name}`);
  if (!modal) return;

  modal.querySelector('[data-fund-transfer-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const amount = readAmount(form.elements.amount);
    const targetId = form.elements.target.value;
    const currentFund = state.funds.find((item) => item.id === fund.id);
    if (!amount || !currentFund) {
      showToast('Enter a valid amount to transfer.', 'error');
      return;
    }
    if (amount > Number(currentFund.balance || 0)) {
      showToast('That amount is greater than this portion balance.', 'error');
      return;
    }

    let nextUser = state.user;
    let nextFunds;
    if (targetId === 'salary') {
      nextUser = { ...state.user, salaryBalance: Number(state.user.salaryBalance || 0) + amount };
      nextFunds = state.funds.map((item) => item.id === fund.id
        ? { ...item, balance: Number(item.balance || 0) - amount }
        : item);
    } else {
      const targetFund = state.funds.find((item) => item.id === targetId);
      if (!targetFund) {
        showToast('Choose a valid destination portion.', 'error');
        return;
      }
      nextFunds = state.funds.map((item) => {
        if (item.id === fund.id) return { ...item, balance: Number(item.balance || 0) - amount };
        if (item.id === targetFund.id) return { ...item, balance: Number(item.balance || 0) + amount };
        return item;
      });
    }

    const targetName = targetId === 'salary'
      ? 'Current salary balance'
      : state.funds.find((item) => item.id === targetId).name;
    const destinationBalanceBefore = targetId === 'salary'
      ? Number(state.user.salaryBalance || 0)
      : Number(state.funds.find((item) => item.id === targetId).balance || 0);
    const transaction = {
      id: makeId('fund-transfer'),
      timestamp: new Date().toISOString(),
      kind: 'fund-transfer',
      from: fund.name,
      to: targetName,
      reason: 'Portion-to-portion transfer',
      total: amount,
      items: [],
      balanceBefore: Number(state.user.salaryBalance || 0),
      balanceAfter: Number(nextUser.salaryBalance || 0),
      sourceBalanceBefore: Number(currentFund.balance || 0),
      sourceBalanceAfter: Number(currentFund.balance || 0) - amount,
      destinationBalanceBefore,
      destinationBalanceAfter: destinationBalanceBefore + amount
    };
    try {
      await persistState({
        ...state,
        user: nextUser,
        funds: nextFunds,
        transactions: appendTransaction(transaction)
      });
      modal.remove();
      onSaved();
      showToast('Transfer complete');
    } catch (error) {
      showToast(error.message || 'Unable to complete this transfer.', 'error');
    }
  });
}

export function openCreateFundForm(onCreated) {
  const modal = openModal(`
    <form class="form-grid" data-create-fund-form>
      <div class="input-group">
        <label for="new-fund-name">Fund name</label>
        <input id="new-fund-name" name="name" type="text" maxlength="40" required />
      </div>
      <div class="button-row">
        <button class="secondary-btn" type="button" data-cancel-fund>Cancel</button>
        <button class="primary-btn" type="submit">Create fund</button>
      </div>
    </form>
  `, 'Create a fund');
  if (!modal) return;

  modal.querySelector('[data-cancel-fund]').addEventListener('click', () => modal.remove());
  modal.querySelector('[data-create-fund-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = sanitizeText(event.currentTarget.elements.name.value).trim();
    if (!name) {
      showToast('Enter a fund name.', 'error');
      return;
    }
    if (state.funds.some((fund) => fund.name.toLowerCase() === name.toLowerCase())) {
      showToast('A fund with that name already exists.', 'error');
      return;
    }
    const fund = { id: makeId('fund'), name, type: 'custom', balance: 0 };
    try {
      await persistState({ ...state, funds: [...state.funds, fund] });
      modal.remove();
      onCreated();
      showToast('Fund created');
    } catch (error) {
      showToast(error.message || 'Unable to create this fund.', 'error');
    }
  });
}

import { state, formatMoney, getCartCount, getCartTotal, getAdditionalCharges, getShopCartTotal, getShopBudget, getShopBudgetRemaining, canAddToShopCart, moneyToCents } from '../state.js';
import { persistState } from '../storage.js';
import { setHash } from '../router.js';
import { showToast } from './toast.js';
import { openModal, confirmAction } from './modal.js';
import { saveReceiptFile, openReceiptFile } from '../receipt.js';

function formatSignedBalance(value) {
  return value < 0 ? `-${formatMoney(Math.abs(value))}` : formatMoney(value);
}

function updateCartChargeSummary(target, charges) {
  const total = getCartTotal() + charges;
  const balance = Number(state.user?.salaryBalance || 0);
  const shopBudget = getShopBudget();
  const shopCartTotal = getShopCartTotal();
  const budgetExceeded = shopBudget && shopCartTotal + charges > shopBudget.limit - shopBudget.spent;
  const expected = target.querySelector('[data-cart-deduction]');
  const after = target.querySelector('[data-cart-balance-after]');
  const remaining = target.querySelector('[data-cart-budget-remaining]');
  const balanceWarning = target.querySelector('[data-cart-insufficient]');
  const budgetWarning = target.querySelector('[data-cart-budget-warning]');
  const checkout = target.querySelector('[data-checkout]');
  if (expected) expected.textContent = formatMoney(total);
  if (after) after.textContent = formatSignedBalance(balance - total);
  if (remaining && shopBudget) remaining.textContent = formatMoney(Math.max(0, shopBudget.limit - shopBudget.spent - shopCartTotal - charges));
  if (balanceWarning) {
    balanceWarning.hidden = total <= balance;
    balanceWarning.textContent = `Insufficient balance. You need ${formatMoney(total - balance)} more.`;
  }
  if (budgetWarning && shopBudget) {
    budgetWarning.hidden = !budgetExceeded;
    budgetWarning.textContent = `Shop budget exceeded by ${formatMoney(shopCartTotal + charges - (shopBudget.limit - shopBudget.spent))}.`;
  }
  if (checkout) checkout.disabled = total > balance || Boolean(budgetExceeded);
}

export function renderCartPage(target) {
  const itemTotal = getCartTotal();
  const additionalCharges = getAdditionalCharges('shop');
  const cartTotal = itemTotal + additionalCharges;
  const balance = Number(state.user?.salaryBalance || 0);
  const afterCheckout = balance - cartTotal;
  const shopBudget = getShopBudget();
  const shopCartTotal = getShopCartTotal();
  const budgetExceeded = shopBudget && shopCartTotal + additionalCharges > (shopBudget.limit - shopBudget.spent);
  const checkoutDisabled = cartTotal > balance || budgetExceeded;

  const grouped = state.cart.reduce((acc, item) => {
    const group = acc[item.store] || [];
    group.push(item);
    acc[item.store] = group;
    return acc;
  }, {});

  const storeSections = Object.entries(grouped).map(([store, items]) => {
    const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
    const renderedItems = items.map((item) => `
      <div class="cart-item">
        <img src="${item.photo || ''}" alt="${item.name}" />
        <div>
          <div><strong>${item.name}</strong></div>
          <div>${item.store}</div>
          <div>${item.type} • ${item.source === 'scan' ? 'Scanned' : 'Shop'}</div>
          <div>${formatMoney(Number(item.price))}</div>
        </div>
        <div>
          <div class="quantity-stepper">
            <button data-cart-dec="${item.productId}|${item.source}">−</button>
            <span>${item.qty}</span>
            <button data-cart-inc="${item.productId}|${item.source}">+</button>
          </div>
          <div style="margin-top: 8px; font-weight: 700; text-align: right;">${formatMoney(Number(item.price) * Number(item.qty))}</div>
        </div>
      </div>
    `).join('');

    return `
      <div class="card">
        <div class="page-header">
          <h3>${store}</h3>
          <span class="tag">${formatMoney(subtotal)}</span>
        </div>
        <div class="list-stack">${renderedItems}</div>
      </div>
    `;
  }).join('');

  target.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div class="row">
          <button class="secondary-btn" data-back-shop aria-label="Back to shop">← Shop</button>
          <h2>Cart</h2>
        </div>
        <button class="secondary-btn" data-clear-cart>Clear cart</button>
      </div>
      ${state.cart.length ? storeSections : '<div class="empty-state">Your cart is empty.</div>'}
      ${state.cart.length ? `
        <div class="cart-summary checkout-bar">
          <div class="metric-row"><span>${shopBudget ? 'Expected budget deduction' : 'Expected salary deduction'}</span><strong class="amount-negative" data-cart-deduction>${formatMoney(cartTotal)}</strong></div>
          <div class="metric-row additional-charge-row">
            <label for="cart-additional-charges">Additional charges</label>
            <input id="cart-additional-charges" type="number" min="0" step="0.01" value="${(additionalCharges / 100).toFixed(2)}" aria-label="Additional charges" />
          </div>
          <div class="metric-row"><span>Current balance</span><strong>${formatMoney(balance)}</strong></div>
          <div class="metric-row"><span>Balance after checkout</span><strong data-cart-balance-after>${formatSignedBalance(afterCheckout)}</strong></div>
          ${shopBudget ? `<div class="metric-row"><span>Shop budget remaining</span><strong data-cart-budget-remaining>${formatMoney(getShopBudgetRemaining())}</strong></div>` : ''}
          <div class="warning-banner" data-cart-insufficient ${cartTotal > balance ? '' : 'hidden'}>Insufficient balance. You need ${formatMoney(cartTotal - balance)} more.</div>
          ${shopBudget ? `<div class="warning-banner" data-cart-budget-warning ${budgetExceeded ? '' : 'hidden'}>Shop budget exceeded by ${formatMoney(shopCartTotal + additionalCharges - (shopBudget.limit - shopBudget.spent))}.</div>` : ''}
          <div class="button-row" style="margin-top: 14px; justify-content: flex-end;">
            <button class="primary-btn" data-checkout ${checkoutDisabled ? 'disabled' : ''}>Checkout</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  target.querySelectorAll('[data-cart-inc]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [productId, source] = button.dataset.cartInc.split('|');
      const item = state.cart.find((entry) => entry.productId === productId && entry.source === source);
      if (item) {
        if (source === 'shop' && !canAddToShopCart(item.price, 1)) {
          showToast('Shop budget limit reached.', 'error');
          return;
        }
        const nextCart = state.cart.map((entry) => entry === item ? { ...entry, qty: entry.qty + 1 } : entry);
        await persistState({ ...state, cart: nextCart });
        renderCartPage(target);
      }
    });
  });

  target.querySelector('[data-back-shop]')?.addEventListener('click', () => setHash('#/shop'));
  target.querySelector('#cart-additional-charges')?.addEventListener('input', (event) => {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value) && value >= 0) updateCartChargeSummary(target, moneyToCents(value));
  });
  target.querySelector('#cart-additional-charges')?.addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) {
      showToast('Additional charges must be zero or greater.', 'error');
      renderCartPage(target);
      return;
    }
    try {
      await persistState({
        ...state,
        settings: { ...state.settings, cartAdditionalCharges: moneyToCents(value) }
      });
      updateCartChargeSummary(target, getAdditionalCharges('shop'));
    } catch (error) {
      showToast(error.message || 'Unable to save additional charges.', 'error');
      input.value = (getAdditionalCharges('shop') / 100).toFixed(2);
      updateCartChargeSummary(target, getAdditionalCharges('shop'));
    }
  });

  target.querySelectorAll('[data-cart-dec]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [productId, source] = button.dataset.cartDec.split('|');
      const item = state.cart.find((entry) => entry.productId === productId && entry.source === source);
      if (!item) return;
      const nextCart = item.qty > 1
        ? state.cart.map((entry) => entry === item ? { ...entry, qty: entry.qty - 1 } : entry)
        : state.cart.filter((entry) => !(entry.productId === productId && entry.source === source));
      try {
        await persistState({ ...state, cart: nextCart });
      } catch (error) {
        showToast('Unable to update the cart.', 'error');
        return;
      }
      if (item.qty <= 1) {
        showToast('Item removed from cart', 'error');
      }
      renderCartPage(target);
    });
  });

  target.querySelector('[data-clear-cart]')?.addEventListener('click', () => {
    confirmAction('Clear cart', 'Remove every item from the cart?', async () => {
      await persistState({ ...state, cart: [] });
      renderCartPage(target);
      showToast('Cart cleared');
    });
  });

  target.querySelector('[data-checkout]')?.addEventListener('click', async () => {
    if (getCartTotal() + getAdditionalCharges('shop') > Number(state.user?.salaryBalance || 0)) {
      showToast('Insufficient balance.', 'error');
      return;
    }
    if (shopBudget && getShopCartTotal() + getAdditionalCharges('shop') > (shopBudget.limit - shopBudget.spent)) {
      showToast('Shop budget limit exceeded.', 'error');
      return;
    }

    confirmAction('Confirm checkout', `Proceed with the simulated purchase? Your salary will decrease by ${formatMoney(getCartTotal() + getAdditionalCharges('shop'))}, including additional charges.`, async () => {
      const balanceBefore = Number(state.user.salaryBalance || 0);
      const charges = getAdditionalCharges('shop');
      const shopTotal = getCartTotal();
      const total = shopTotal + charges;
      const items = state.cart.map((item) => ({
        name: item.name,
        price: Number(item.price),
        qty: Number(item.qty),
        store: item.store,
        type: item.type,
        photo: item.photo,
        source: item.source
      }));

      const balanceAfter = balanceBefore - total;
      const nextUser = { ...state.user, salaryBalance: balanceAfter };
      if (shopBudget) nextUser.shopBudget = { ...state.user.shopBudget, spent: state.user.shopBudget.spent + getShopCartTotal() + charges };
      const transaction = {
        id: `txn_${Date.now()}`,
        timestamp: new Date().toISOString(),
        total,
        additionalCharges: charges,
        items,
        balanceBefore,
        balanceAfter
      };
      await persistState({
        ...state,
        user: nextUser,
        transactions: [transaction, ...state.transactions],
        cart: [],
        settings: { ...state.settings, cartAdditionalCharges: 0 }
      });

      const receipt = await saveReceiptFile(transaction);
      if (receipt && receipt.path) {
        const openDecision = window.confirm('Receipt saved. Open it now?');
        if (openDecision) {
          await openReceiptFile(receipt);
        }
      }

      showToast('Checkout successful');
      setHash('#/dashboard');
    });
  });
}

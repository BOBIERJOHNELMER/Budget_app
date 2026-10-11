import { state, formatMoney, sanitizeText, moneyToCents, getAdditionalCharges } from '../state.js';
import { persistState } from '../storage.js';
import { captureCameraPhoto, chooseImageFromGallery, compressImageDataUrl } from '../camera.js';
import { showToast } from './toast.js';
import { setHash } from '../router.js';
import { parsePriceFromPhoto } from '../ocr.js';
import { saveReceiptFile, openReceiptFile } from '../receipt.js';
import { openModal } from './modal.js';

const typeOptions = ['Grocery', 'Merchandise', 'Medicine'];

function formatSignedBalance(value) {
  return value < 0 ? `-${formatMoney(Math.abs(value))}` : formatMoney(value);
}

function scanCartTotal() {
  return state.scanCart.reduce((sum, item) => {
    const price = Number(item.price) || 0;
    const qty = Math.max(1, Number(item.qty) || 1);
    return sum + price * qty;
  }, 0);
}

function updateScanChargeSummary(target, charges) {
  const total = scanCartTotal() + charges;
  const balance = Number(state.user?.salaryBalance || 0);
  const expected = target.querySelector('[data-scan-deduction]');
  const after = target.querySelector('[data-scan-balance-after]');
  const warning = target.querySelector('[data-scan-insufficient]');
  const checkout = target.querySelector('[data-buy-scan]');
  if (expected) expected.textContent = formatMoney(total);
  if (after) after.textContent = formatSignedBalance(balance - total);
  if (warning) {
    warning.hidden = total <= balance;
    warning.textContent = `Insufficient balance. You need ${formatMoney(total - balance)} more.`;
  }
  if (checkout) checkout.disabled = total > balance;
}

function renderScanCart(target) {
  const itemTotal = scanCartTotal();
  const additionalCharges = getAdditionalCharges('scan');
  const total = itemTotal + additionalCharges;
  const balance = Number(state.user?.salaryBalance || 0);
  const afterCheckout = balance - total;
  const items = state.scanCart.map((item) => `
    <div class="scan-cart-item">
      ${item.photo ? `<img src="${item.photo}" alt="${sanitizeText(item.name)}" />` : ''}
      <div class="scan-cart-details">
        <strong>${sanitizeText(item.name)}</strong>
        <span>${formatMoney(Number(item.price))}</span>
        <div class="quantity-stepper">
          <button type="button" data-scan-dec="${item.id}" aria-label="Reduce quantity">-</button>
          <span>${item.qty}</span>
          <button type="button" data-scan-inc="${item.id}" aria-label="Increase quantity">+</button>
        </div>
        <button type="button" class="secondary-btn scan-shop-button" data-scan-shop="${item.id}">${item.saveToShop ? 'Shop product saved' : 'Add to Shop'}</button>
      </div>
      <strong>${formatMoney((Number(item.price) || 0) * Math.max(1, Number(item.qty) || 1))}</strong>
    </div>
  `).join('');

  const cartRoot = target.querySelector('[data-scan-cart]');
  cartRoot.innerHTML = `
    <div class="page-header">
      <div>
        <h3>Scan Cart</h3>
        <p class="shop-budget-note">Separate from Shop Cart</p>
      </div>
      ${state.scanCart.length ? '<button type="button" class="secondary-btn" data-clear-scan-cart>Clear</button>' : ''}
    </div>
    ${items || '<div class="empty-state">Add a scanned product above.</div>'}
    ${state.scanCart.length ? `
      <div class="scan-cart-summary">
        <div class="metric-row"><span>Expected salary deduction</span><strong class="amount-negative" data-scan-deduction>${formatMoney(total)}</strong></div>
        <div class="metric-row additional-charge-row">
          <label for="scan-additional-charges">Additional charges</label>
          <input id="scan-additional-charges" type="number" min="0" step="0.01" value="${(additionalCharges / 100).toFixed(2)}" aria-label="Additional charges" />
        </div>
        <div class="metric-row"><span>Current balance</span><strong>${formatMoney(balance)}</strong></div>
        <div class="metric-row"><span>Balance after checkout</span><strong data-scan-balance-after>${formatSignedBalance(afterCheckout)}</strong></div>
        <div class="warning-banner" data-scan-insufficient ${total > balance ? '' : 'hidden'}>Insufficient balance. You need ${formatMoney(total - balance)} more.</div>
        <button type="button" class="primary-btn" data-buy-scan ${total > balance ? 'disabled' : ''}>Buy scanned products</button>
      </div>
    ` : ''}
  `;

  target.querySelectorAll('[data-scan-inc]').forEach((button) => button.addEventListener('click', async () => {
    const item = state.scanCart.find((entry) => entry.id === button.dataset.scanInc);
    if (item) item.qty += 1;
    await persistState();
    renderScanCart(target);
  }));
  target.querySelectorAll('[data-scan-dec]').forEach((button) => button.addEventListener('click', async () => {
    const item = state.scanCart.find((entry) => entry.id === button.dataset.scanDec);
    if (!item) return;
    if (item.qty > 1) item.qty -= 1;
    else state.scanCart = state.scanCart.filter((entry) => entry.id !== item.id);
    await persistState();
    renderScanCart(target);
  }));
  target.querySelectorAll('[data-scan-shop]').forEach((button) => button.addEventListener('click', () => openSaveScanProductModal(target, button.dataset.scanShop)));
  target.querySelector('[data-clear-scan-cart]')?.addEventListener('click', async () => {
    state.scanCart = [];
    await persistState();
    renderScanCart(target);
  });
  target.querySelector('#scan-additional-charges')?.addEventListener('input', (event) => {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value) && value >= 0) updateScanChargeSummary(target, moneyToCents(value));
  });
  target.querySelector('#scan-additional-charges')?.addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) {
      showToast('Additional charges must be zero or greater.', 'error');
      renderScanCart(target);
      return;
    }
    try {
      await persistState({
        ...state,
        settings: { ...state.settings, scanAdditionalCharges: moneyToCents(value) }
      });
      updateScanChargeSummary(target, getAdditionalCharges('scan'));
    } catch (error) {
      showToast(error.message || 'Unable to save additional charges.', 'error');
      input.value = (getAdditionalCharges('scan') / 100).toFixed(2);
      updateScanChargeSummary(target, getAdditionalCharges('scan'));
    }
  });
  target.querySelector('[data-buy-scan]')?.addEventListener('click', () => buyScannedProducts(target));
}

function openSaveScanProductModal(target, itemId) {
  const item = state.scanCart.find((entry) => entry.id === itemId);
  if (!item) return;
  const market = state.scanMarket || item.store;
  const modal = openModal(`
    <form id="save-scan-product-form" class="form-grid" novalidate>
      ${item.photo ? `<img class="preview-box" src="${item.photo}" alt="${sanitizeText(item.name)}" />` : ''}
      <div class="input-group"><label for="scan-shop-name">Product name</label><input id="scan-shop-name" value="${sanitizeText(item.name)}" required /></div>
      <div class="input-group"><label for="scan-shop-price">Price</label><input id="scan-shop-price" type="number" min="0.01" step="0.01" value="${(Number(item.price) / 100).toFixed(2)}" required /></div>
      <div class="input-group"><label for="scan-shop-store">Market</label><select id="scan-shop-store" required>${state.stores.map((store) => `<option value="${sanitizeText(store)}" ${market === store ? 'selected' : ''}>${sanitizeText(store)}</option>`).join('')}</select></div>
      <div class="input-group"><label for="scan-shop-type">Product type</label><select id="scan-shop-type" required><option value="">Select type</option>${typeOptions.map((type) => `<option value="${type}" ${item.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
      <div class="button-row"><button type="button" class="secondary-btn" data-close-save-scan>Cancel</button><button type="submit" class="primary-btn">Save to Shop</button></div>
    </form>
  `, 'Save scanned product to Shop');
  modal.querySelector('[data-close-save-scan]').addEventListener('click', () => modal.remove());
  modal.querySelector('#save-scan-product-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = modal.querySelector('#scan-shop-name').value.trim();
    const price = Number(modal.querySelector('#scan-shop-price').value);
    const store = state.scanMarket || modal.querySelector('#scan-shop-store').value;
    const type = modal.querySelector('#scan-shop-type').value;
    if (!name || !Number.isFinite(price) || price <= 0 || !store || !type) {
      showToast('Complete the product name, price, market, and type.', 'error');
      return;
    }
    item.name = name;
    item.price = moneyToCents(price);
    item.store = store;
    item.type = type;
    item.saveToShop = true;
    const duplicate = state.products.find((product) => product.name.toLowerCase() === name.toLowerCase() && product.store === store);
    if (!duplicate) state.products.push({ id: item.id, name, price: item.price, store, type, photo: item.photo || '', createdAt: new Date().toISOString() });
    await persistState();
    modal.remove();
    renderScanCart(target);
    showToast('Product saved to Shop');
  });
}

async function buyScannedProducts(target) {
  const additionalCharges = getAdditionalCharges('scan');
  const total = scanCartTotal() + additionalCharges;
  const balanceBefore = Number(state.user?.salaryBalance || 0);
  if (!total) {
    showToast('Add a scanned product with a valid price first.', 'error');
    return;
  }
  if (total > balanceBefore) {
    showToast('Insufficient salary balance.', 'error');
    return;
  }
  const items = state.scanCart.map((item) => ({
    name: item.name,
    price: Number(item.price),
    qty: Math.max(1, Number(item.qty) || 1),
    store: state.scanMarket || item.store || 'Scanned item',
    type: item.type || 'Scanned',
    photo: item.saveToShop ? item.photo : '',
    source: 'scan'
  }));
  const balanceAfter = balanceBefore - total;
  const nextUser = { ...state.user, salaryBalance: balanceAfter };
  const transaction = {
    id: `scan_txn_${Date.now()}`,
    timestamp: new Date().toISOString(),
    total,
    additionalCharges,
    items,
    balanceBefore,
    balanceAfter
  };
  await persistState({
    ...state,
    user: nextUser,
    transactions: [transaction, ...state.transactions],
    scanCart: [],
    settings: { ...state.settings, scanAdditionalCharges: 0 }
  });

  showScanSuccess(target, transaction);
}

function showScanSuccess(target, transaction) {
  const overlay = document.createElement('div');
  overlay.className = 'scan-success-overlay';
  overlay.innerHTML = `
    <div class="scan-confetti" aria-hidden="true">${Array.from({ length: 28 }, (_, index) => `<span style="--i:${index}"></span>`).join('')}</div>
    <div class="scan-success-card" role="dialog" aria-modal="true" aria-labelledby="scan-success-title">
      <div class="success-mark">✓</div>
      <h2 id="scan-success-title">Your transaction was a success!</h2>
      <p>${formatMoney(Number(transaction.total))} was deducted from your salary balance.</p>
      <div class="button-row scan-success-actions">
        <button type="button" class="secondary-btn" data-download-scan-receipt>Download PDF receipt</button>
        <button type="button" class="primary-btn" data-continue-scan>Continue</button>
      </div>
    </div>
  `;
  target.appendChild(overlay);
  overlay.querySelector('[data-download-scan-receipt]').addEventListener('click', async () => {
    try {
      const receipt = await saveReceiptFile(transaction);
      if (receipt?.path) await openReceiptFile(receipt);
      else showToast('Unable to create the PDF receipt.', 'error');
    } catch (error) {
      showToast(error.message || 'Unable to download the PDF receipt.', 'error');
    }
  });
  overlay.querySelector('[data-continue-scan]').addEventListener('click', () => {
    overlay.remove();
    renderScanPage(target);
  });
}

export function renderScanPage(target) {
  let photo = '';
  const selectedMarket = state.scanMarket || state.stores[0] || '';
  target.innerHTML = `
    <div class="page">
      <div class="page-header"><h2>Scan shelf price</h2></div>
      <div class="card scan-market-card">
        <div class="input-group">
          <label for="scan-market">Market</label>
          <select id="scan-market">
            ${state.stores.map((store) => `<option value="${sanitizeText(store)}" ${selectedMarket === store ? 'selected' : ''}>${sanitizeText(store)}</option>`).join('')}
          </select>
          <div class="shop-budget-note">All scanned products will use this market.</div>
        </div>
      </div>
      <div class="card">
        <div class="photo-actions">
          <button type="button" class="secondary-btn" id="scan-photo-camera">Take Photo</button>
          <button type="button" class="secondary-btn" id="scan-photo-gallery">Import from Gallery</button>
        </div>
        <div id="scan-preview" class="empty-state">No photo yet.</div>
        <div id="scan-ocr-status" class="shop-budget-note" aria-live="polite"></div>
        <form id="scan-form" class="form-grid" style="margin-top: 16px;">
          <div class="input-group"><label for="scan-price">Price</label><input id="scan-price" type="number" min="0.01" step="0.01" required /><div class="form-error" data-error="price"></div></div>
          <div class="input-group"><label for="scan-name">Item name</label><input id="scan-name" type="text" required /><div class="form-error" data-error="name"></div></div>
          <div class="button-row"><button type="button" class="secondary-btn" id="scan-cancel">Cancel</button><button type="submit" class="primary-btn">Add to Scan Cart</button></div>
        </form>
      </div>
      <div class="card scan-cart-box" data-scan-cart></div>
    </div>
  `;

  const preview = target.querySelector('#scan-preview');
  const priceInput = target.querySelector('#scan-price');
  const nameInput = target.querySelector('#scan-name');
  const marketInput = target.querySelector('#scan-market');
  state.scanCart.forEach((item) => { item.store = marketInput.value; });
  const validate = () => {
    const priceValid = Number(priceInput.value) > 0;
    const nameValid = nameInput.value.trim().length > 0;
    target.querySelector('[data-error="price"]').textContent = priceValid ? '' : 'Price is required.';
    target.querySelector('[data-error="name"]').textContent = nameValid ? '' : 'Name is required.';
    return priceValid && nameValid;
  };
  const updatePreview = (image) => {
    photo = image;
    const img = document.createElement('img');
    img.className = 'preview-box';
    img.src = image;
    img.alt = 'Scanned item preview';
    preview.replaceWith(img);
  };
  const processPhoto = async (image) => {
    const compressed = await compressImageDataUrl(image, 1200, 0.85);
    updatePreview(compressed);
    const status = target.querySelector('#scan-ocr-status');
    status.textContent = 'Reading product name and price...';
    try {
      const extracted = await parsePriceFromPhoto(compressed, (progress) => { status.textContent = `Reading photo... ${Math.round(progress * 100)}%`; });
      if (extracted.name) nameInput.value = extracted.name;
      if (extracted.price) priceInput.value = extracted.price.toFixed(2);
      status.textContent = extracted.note;
      validate();
    } catch (error) {
      status.textContent = 'OCR could not read the photo. Enter the name and price manually.';
      showToast('Photo captured, but OCR could not read it.', 'error');
    }
  };
  target.querySelector('#scan-photo-camera').addEventListener('click', async () => { try { await processPhoto(await captureCameraPhoto()); } catch (error) { showToast(error.message, 'error'); } });
  target.querySelector('#scan-photo-gallery').addEventListener('click', async () => { try { await processPhoto(await chooseImageFromGallery()); } catch (error) { showToast(error.message, 'error'); } });
  target.querySelector('#scan-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validate()) return;
    state.scanCart.push({ id: `scan_${Date.now()}`, name: nameInput.value.trim(), price: moneyToCents(Number(priceInput.value)), photo, qty: 1, saveToShop: false, store: marketInput.value, type: '' });
    await persistState();
    priceInput.value = '';
    nameInput.value = '';
    target.querySelector('#scan-ocr-status').textContent = 'Added to Scan Cart.';
    renderScanCart(target);
    showToast('Added to Scan Cart');
  });
  target.querySelector('#scan-cancel').addEventListener('click', () => setHash('#/dashboard'));
  marketInput.addEventListener('change', async () => {
    state.scanMarket = marketInput.value;
    state.scanCart.forEach((item) => { item.store = marketInput.value; });
    await persistState();
    renderScanCart(target);
  });
  [priceInput, nameInput].forEach((input) => input.addEventListener('input', validate));
  renderScanCart(target);
}

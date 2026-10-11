import { state, PRODUCT_TYPES, SUBTYPE_MAP, addToCart, getCartCount, formatMoney, sanitizeText, addStore, moneyToCents, getShopBudget, getShopBudgetRemaining, canAddToShopCart } from '../state.js';
import { setHash } from '../router.js';
import { persistState } from '../storage.js';
import { showToast } from './toast.js';
import { openModal, closeModal } from './modal.js';
import { captureCameraPhoto, chooseImageFromGallery, compressImageDataUrl } from '../camera.js';

function renderProductCard(product) {
  const inCart = state.cart.find((item) => item.productId === product.id);
  const image = product.photo || 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#dfeaf7"/><text x="100" y="80" font-size="24" text-anchor="middle" fill="#2d6cdf">🛍️</text></svg>');

  return `
    <article class="product-card" data-product-id="${product.id}">
      <img class="product-photo" src="${image}" alt="${sanitizeText(product.name)}" />
      <div class="product-body">
        <div class="meta-row">
          <span class="tag">${sanitizeText(product.type)}</span>
          <button class="icon-button" data-edit-product="${product.id}" aria-label="Edit ${sanitizeText(product.name)}">✎</button>
        </div>
        <div class="product-name">${sanitizeText(product.name)}</div>
        <div class="product-price">${formatMoney(Number(product.price || 0))}</div>
        <div class="product-meta-line">
          <span>${sanitizeText(product.type)}</span>
          <span>${sanitizeText(product.store)}</span>
        </div>
        ${inCart ? `
          <div class="quantity-stepper">
            <button data-dec-product="${product.id}" aria-label="Reduce quantity">−</button>
            <span>${inCart.qty}</span>
            <button data-inc-product="${product.id}" aria-label="Increase quantity">+</button>
          </div>
        ` : `<button class="primary-btn" data-add-product="${product.id}">Add to cart</button>`}
      </div>
    </article>
  `;
}

function renderShopFilters(products, query, selectedType, selectedSubtype, selectedStore) {
  const typeChips = ['All', ...PRODUCT_TYPES].map((type) => `
    <button class="chip ${selectedType === type ? 'active' : ''}" data-filter-type="${type}">${type}</button>
  `).join('');

  const subtypeList = selectedType === 'All' ? ['All'] : SUBTYPE_MAP[selectedType] || ['All'];
  const subtypeChips = subtypeList.map((subtype) => `
    <button class="chip ${selectedSubtype === subtype ? 'active' : ''}" data-filter-subtype="${subtype}">${subtype}</button>
  `).join('');

  const storeOptions = ['All Stores', ...state.stores].map((store) => `
    <option value="${sanitizeText(store)}" ${selectedStore === store ? 'selected' : ''}>${sanitizeText(store)}</option>
  `).join('');

  return `
    <div class="card">
      <input class="search-bar" id="shop-search" value="${sanitizeText(query)}" placeholder="Search products" />
      <div class="filter-row">${typeChips}</div>
      <div class="filter-row">${subtypeChips}</div>
      <div class="input-group" style="margin-top: 12px;">
        <label for="shop-store-filter">Store</label>
        <select id="shop-store-filter">${storeOptions}</select>
      </div>
    </div>
  `;
}

export function renderShopPage(target) {
  const query = (window.__shopFilters && window.__shopFilters.query) || '';
  const selectedType = (window.__shopFilters && window.__shopFilters.type) || 'All';
  const selectedSubtype = (window.__shopFilters && window.__shopFilters.subtype) || 'All';
  const selectedStore = (window.__shopFilters && window.__shopFilters.store) || 'All Stores';
  const budget = getShopBudget();
  const salaryBalance = Number(state.user?.salaryBalance || 0);
  const availableToSpend = budget ? getShopBudgetRemaining() : salaryBalance;

  const filtered = (state.products || []).filter((product) => {
    const matchesQuery = !query || product.name.toLowerCase().includes(query.toLowerCase()) || product.store.toLowerCase().includes(query.toLowerCase());
    const matchesType = selectedType === 'All' || product.type === selectedType;
    const matchesSubtype = selectedSubtype === 'All' || product.type === selectedType ? true : true;
    const matchesStore = selectedStore === 'All Stores' || product.store === selectedStore;
    return matchesQuery && matchesType && matchesSubtype && matchesStore;
  });

  target.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Shop</h2>
        <button class="icon-button shop-cart-button" data-link="#/cart" aria-label="Open cart${getCartCount() ? `, ${getCartCount()} items` : ''}">
          <svg class="shop-cart-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 8H6" />
            <circle cx="10" cy="20" r="1.2" />
            <circle cx="18" cy="20" r="1.2" />
          </svg>
          ${getCartCount() ? `<span class="shop-cart-count">${getCartCount()}</span>` : ''}
        </button>
      </div>
      <div class="shop-budget-panel">
        <div>
          <span class="eyebrow">Available to spend</span>
          <strong class="shop-balance-value">${formatMoney(availableToSpend)}</strong>
          ${budget ? `<div class="shop-budget-note">Shop budget remaining. Salary balance: ${formatMoney(salaryBalance)}</div>` : '<div class="shop-budget-note">Use your salary balance or set a shop limit.</div>'}
        </div>
        <button class="secondary-btn" data-shop-budget>${budget ? 'Edit limit' : 'Set limit'}</button>
      </div>
      ${renderShopFilters(state.products, query, selectedType, selectedSubtype, selectedStore)}
      <div class="products-grid">${filtered.map(renderProductCard).join('') || '<div class="empty-state">No matching products found.</div>'}</div>
    </div>
    <button class="floating-add" aria-label="Add new product" data-add-product-form><span aria-hidden="true">+</span></button>
  `;

  target.querySelector('#shop-search').addEventListener('input', (event) => {
    window.__shopFilters = window.__shopFilters || {};
    window.__shopFilters.query = event.target.value.trim();
    renderShopPage(target);
  });

  target.querySelector('[data-shop-budget]').addEventListener('click', () => openShopBudgetForm(target));

  target.querySelectorAll('[data-filter-type]').forEach((button) => {
    button.addEventListener('click', () => {
      window.__shopFilters = window.__shopFilters || {};
      window.__shopFilters.type = button.dataset.filterType;
      if (button.dataset.filterType !== 'All') {
        window.__shopFilters.subtype = 'All';
      }
      renderShopPage(target);
    });
  });

  target.querySelectorAll('[data-filter-subtype]').forEach((button) => {
    button.addEventListener('click', () => {
      window.__shopFilters = window.__shopFilters || {};
      window.__shopFilters.subtype = button.dataset.filterSubtype;
      renderShopPage(target);
    });
  });

  target.querySelector('#shop-store-filter').addEventListener('change', (event) => {
    window.__shopFilters = window.__shopFilters || {};
    window.__shopFilters.store = event.target.value;
    renderShopPage(target);
  });

  target.querySelectorAll('[data-add-product]').forEach((button) => {
    button.addEventListener('click', async () => {
      const product = state.products.find((item) => item.id === button.dataset.addProduct);
      if (product) {
        if (!canAddToShopCart(product.price, 1)) {
          showToast('Shop budget limit reached.', 'error');
          return;
        }
        const previousCart = state.cart.map((entry) => ({ ...entry }));
        addToCart(product, 1, 'shop');
        try {
          await persistState();
        } catch (error) {
          state.cart = previousCart;
          showToast('Unable to save the cart.', 'error');
          return;
        }
        renderShopPage(target);
        showToast(`Added ${product.name}`);
      }
    });
  });

  target.querySelectorAll('[data-inc-product]').forEach((button) => {
    button.addEventListener('click', async () => {
      const product = state.products.find((item) => item.id === button.dataset.incProduct);
      if (product) {
        const item = state.cart.find((entry) => entry.productId === product.id && entry.source === 'shop');
        if (!canAddToShopCart(product.price, 1)) {
          showToast('Shop budget limit reached.', 'error');
          return;
        }
        const nextCart = state.cart.map((entry) => entry === item ? { ...entry, qty: entry.qty + 1 } : entry);
        await persistState({ ...state, cart: nextCart });
        renderShopPage(target);
      }
    });
  });

  target.querySelectorAll('[data-dec-product]').forEach((button) => {
    button.addEventListener('click', async () => {
      const product = state.products.find((item) => item.id === button.dataset.decProduct);
      if (product) {
        const item = state.cart.find((entry) => entry.productId === product.id && entry.source === 'shop');
        const nextCart = item && item.qty > 1
          ? state.cart.map((entry) => entry === item ? { ...entry, qty: entry.qty - 1 } : entry)
          : state.cart.filter((entry) => !(entry.productId === product.id && entry.source === 'shop'));
        await persistState({ ...state, cart: nextCart });
        renderShopPage(target);
      }
    });
  });

  target.querySelectorAll('[data-edit-product]').forEach((button) => {
    button.addEventListener('click', () => openEditProduct(button.dataset.editProduct));
  });

  target.querySelector('[data-add-product-form]').addEventListener('click', () => openProductForm());
  target.querySelectorAll('[data-link]').forEach((button) => button.addEventListener('click', () => setHash(button.dataset.link)));
}

function openShopBudgetForm(target) {
  const budget = getShopBudget();
  const currentLimit = budget ? (budget.limit - budget.spent) / 100 : '';
  const modal = openModal(`
    <form id="shop-budget-form" class="form-grid" novalidate>
      <p class="modal-help">Set the maximum amount available for products added from Shop. Your actual purchase still comes from your salary balance.</p>
      <div class="input-group">
        <label for="shop-budget-limit">Shop budget limit</label>
        <input id="shop-budget-limit" type="number" min="0.01" step="0.01" value="${currentLimit}" required />
        <div class="form-error" data-budget-error></div>
      </div>
      <label class="row budget-toggle"><input id="shop-budget-enabled" type="checkbox" ${budget ? 'checked' : ''} /> Enable shop limit</label>
      <div class="button-row">
        <button type="button" class="secondary-btn" data-disable-budget ${budget ? '' : 'hidden'}>Use salary balance</button>
        <button type="submit" class="primary-btn">Save limit</button>
      </div>
    </form>
  `, 'Shop spending limit');
  if (!modal) return;
  const form = modal.querySelector('#shop-budget-form');
  const limitInput = modal.querySelector('#shop-budget-limit');
  const enabledInput = modal.querySelector('#shop-budget-enabled');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const limit = Number(limitInput.value);
    if (!Number.isFinite(limit) || limit <= 0) {
      modal.querySelector('[data-budget-error]').textContent = 'Enter a budget greater than zero.';
      return;
    }
    const spent = budget ? Math.min(budget.spent, moneyToCents(limit)) : 0;
    state.user.shopBudget = { enabled: enabledInput.checked, limit: moneyToCents(limit), spent };
    await persistState();
    modal.remove();
    renderShopPage(target);
    showToast(enabledInput.checked ? 'Shop limit enabled' : 'Shop limit saved');
  });
  modal.querySelector('[data-disable-budget]')?.addEventListener('click', async () => {
    state.user.shopBudget = { enabled: false, limit: 0, spent: 0 };
    await persistState();
    modal.remove();
    renderShopPage(target);
    showToast('Shop limit disabled');
  });
}

function openProductForm(productId = null) {
  const product = productId ? state.products.find((item) => item.id === productId) : null;
  const selectedType = product?.type || 'Grocery';
  const photoValue = product?.photo || '';
  const formHtml = `
    <form id="product-form" novalidate>
      <div class="photo-actions">
        <button type="button" class="secondary-btn" data-photo-camera>Take Photo</button>
        <button type="button" class="secondary-btn" data-photo-gallery>Import from Gallery</button>
      </div>
      ${photoValue ? `<img class="preview-box" src="${photoValue}" alt="Product preview" />` : '<div class="empty-state">No photo selected.</div>'}
      <div class="form-grid" style="margin-top: 12px;">
        <div class="input-group">
          <label for="product-name">Name</label>
          <input id="product-name" name="name" value="${sanitizeText(product?.name || '')}" required />
          <div class="form-error" data-error="name"></div>
        </div>
        <div class="input-group">
          <label for="product-price">Price</label>
          <input id="product-price" name="price" type="number" min="0.01" step="0.01" value="${product ? Number(product.price || 0) / 100 : ''}" required />
          <div class="form-error" data-error="price"></div>
        </div>
        <div class="input-group">
          <label for="product-store">Store</label>
          <select id="product-store" name="store">
            ${state.stores.map((store) => `<option value="${sanitizeText(store)}" ${product && product.store === store ? 'selected' : ''}>${sanitizeText(store)}</option>`).join('')}
            <option value="__new__">Add new store…</option>
          </select>
          <div class="form-error" data-error="store"></div>
        </div>
        <div class="input-group">
          <label for="product-type">Type</label>
          <select id="product-type" name="type">
            ${PRODUCT_TYPES.map((type) => `<option value="${type}" ${selectedType === type ? 'selected' : ''}>${type}</option>`).join('')}
          </select>
          <div class="form-error" data-error="type"></div>
        </div>
      </div>
      <div class="button-row" style="margin-top: 16px; justify-content: flex-end;">
        <button type="button" class="secondary-btn" data-close-form>Cancel</button>
        <button type="submit" class="primary-btn" id="save-product-btn" disabled>Save</button>
      </div>
    </form>
  `;

  const modal = openModal(formHtml, product ? 'Edit product' : 'Add new product');
  const form = modal.querySelector('#product-form');
  let photoData = photoValue;

  const setFormError = (field, message) => {
    const error = modal.querySelector(`[data-error="${field}"]`);
    if (error) error.textContent = message || '';
  };

  const validate = () => {
    const name = modal.querySelector('#product-name').value.trim();
    const price = Number(modal.querySelector('#product-price').value);
    const storeField = modal.querySelector('#product-store').value;
    const type = modal.querySelector('#product-type').value;
    const valid = Boolean(name && photoData && Number.isFinite(price) && price > 0 && storeField && storeField !== '__new__' && type);

    const saveButton = modal.querySelector('#save-product-btn');
    saveButton.disabled = !valid;

    setFormError('name', name ? '' : 'Name is required.');
    setFormError('price', Number.isFinite(price) && price > 0 ? '' : 'Price must be greater than zero.');
    setFormError('store', storeField && storeField !== '__new__' ? '' : 'Store is required.');
    setFormError('type', type ? '' : 'Type is required.');
    return valid;
  };

  modal.querySelectorAll('input, select').forEach((field) => field.addEventListener('input', validate));
  modal.querySelectorAll('input, select').forEach((field) => field.addEventListener('change', validate));

  modal.querySelector('[data-close-form]').addEventListener('click', () => modal.remove());

  modal.querySelector('[data-photo-camera]').addEventListener('click', async () => {
    try {
      const data = await captureCameraPhoto();
      const compressed = await compressImageDataUrl(data, 800, 0.7);
      photoData = compressed;
      modal.querySelector('.preview-box')?.remove();
      const img = document.createElement('img');
      img.className = 'preview-box';
      img.src = compressed;
      img.alt = 'Selected product photo';
      modal.querySelector('.empty-state')?.replaceWith(img);
      validate();
    } catch (error) {
      showToast(error.message || 'Unable to capture a photo.', 'error');
    }
  });

  modal.querySelector('[data-photo-gallery]').addEventListener('click', async () => {
    try {
      const data = await chooseImageFromGallery();
      const compressed = await compressImageDataUrl(data, 800, 0.7);
      photoData = compressed;
      modal.querySelector('.preview-box')?.remove();
      const img = document.createElement('img');
      img.className = 'preview-box';
      img.src = compressed;
      img.alt = 'Selected product photo';
      modal.querySelector('.empty-state')?.replaceWith(img);
      validate();
    } catch (error) {
      showToast(error.message || 'No image selected.', 'error');
    }
  });

  modal.querySelector('#product-store').addEventListener('change', async (event) => {
    if (event.target.value === '__new__') {
      const storeName = window.prompt('Add new store:', '');
      if (storeName) {
        const created = addStore(storeName);
        if (created) {
          // Persist the new store immediately so it survives even if the product form is cancelled
          try { await persistState(); } catch (_) { /* best effort */ }
          event.target.innerHTML = state.stores.map((store) => `<option value="${sanitizeText(store)}">${sanitizeText(store)}</option>`).concat('<option value="__new__">Add new store…</option>').join('');
          event.target.value = created;
        }
      } else {
        event.target.value = '';
      }
    }
    validate();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validate()) return;

    const name = modal.querySelector('#product-name').value.trim();
    const price = moneyToCents(Number(modal.querySelector('#product-price').value));
    const store = modal.querySelector('#product-store').value;
    const type = modal.querySelector('#product-type').value;

    const duplicate = state.products.find((entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.store === store && (!product || entry.id !== product.id));
    if (duplicate) {
      showToast('A product with the same name and store already exists.', 'error');
      return;
    }

    const previousProducts = state.products.map((entry) => ({ ...entry }));
    if (!product) {
      const newProduct = {
        id: `product_${Date.now()}`,
        name,
        price,
        store,
        type,
        photo: photoData,
        createdAt: new Date().toISOString()
      };
      state.products.push(newProduct);
    } else {
      product.name = name;
      product.price = price;
      product.store = store;
      product.type = type;
      product.photo = photoData;
    }

    try {
      await persistState();
    } catch (error) {
      state.products = previousProducts;
      showToast('Unable to save the product.', 'error');
      return;
    }
    showToast(product ? 'Product updated' : 'Product added');
    closeModal();
    renderShopPage(document.getElementById('page-root'));
  });
}

function openEditProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  const modal = openModal(`
    <div class="button-row">
      <button class="secondary-btn" data-edit-product-action="${product.id}">Edit</button>
      <button class="danger-btn" data-delete-product-action="${product.id}">Delete</button>
    </div>
  `, `Manage ${sanitizeText(product.name)}`);

  modal.querySelector('[data-edit-product-action]').addEventListener('click', () => {
    modal.remove();
    openProductForm(product.id);
  });

  modal.querySelector('[data-delete-product-action]').addEventListener('click', async () => {
    const confirm = window.confirm(`Delete ${product.name}?`);
    if (confirm) {
      const nextProducts = state.products.filter((item) => item.id !== product.id);
      await persistState({ ...state, products: nextProducts });
      modal.remove();
      renderShopPage(document.getElementById('page-root'));
      showToast('Product removed');
    }
  });
}

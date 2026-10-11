import { state } from './state.js';
import { renderDashboardPage } from './ui/dashboard.js';
import { renderShopPage } from './ui/shop.js';
import { renderCartPage } from './ui/cart.js';
import { renderScanPage } from './ui/scan.js';
import { renderProfilePage } from './ui/profile.js';
import { renderFundPage } from './ui/allocations.js';
import { renderAiBudgetingPage } from './ui/ai-budgeting.js';

export function setHash(hash) {
  if (!hash || !hash.startsWith('#/')) {
    window.location.hash = '#/dashboard';
    return;
  }
  window.location.hash = hash;
}

export function getCurrentRoute() {
  return window.location.hash || '#/dashboard';
}

export function renderRoute() {
  const route = getCurrentRoute();
  state.route = route;
  const routeMap = {
    '#/dashboard': renderDashboardPage,
    '#/shop': renderShopPage,
    '#/cart': renderCartPage,
    '#/scan': renderScanPage,
    '#/profile': renderProfilePage,
    '#/ai-budgeting': renderAiBudgetingPage
  };

  const root = document.getElementById('page-root');
  if (root) {
    if (route.startsWith('#/fund/')) {
      renderFundPage(root, route.slice('#/fund/'.length));
    } else {
      (routeMap[route] || renderDashboardPage)(root);
    }
  }

  document.querySelectorAll('.nav-item').forEach((button) => {
    const isDashboardRoute = route.startsWith('#/fund/');
    const isProfileRoute = route === '#/ai-budgeting';
    const isActive = button.dataset.route === route
      || (isDashboardRoute && button.dataset.route === '#/dashboard')
      || (isProfileRoute && button.dataset.route === '#/profile');
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

export function initRouter() {
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

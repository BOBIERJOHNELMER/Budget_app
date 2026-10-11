export function showToast(message, variant = 'default') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  if (variant === 'error') toast.style.background = '#b94242';
  if (variant === 'success') toast.style.background = '#1d8b5d';
  root.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

export function showWelcomeNotification(name, showLowBalance = false) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const addNotification = (message, warning = false, visibleDuration = 1150) => {
    const notification = document.createElement('div');
    notification.className = `welcome-notification${warning ? ' low-balance-notification' : ''}`;
    notification.setAttribute('role', 'status');
    notification.textContent = message;
    root.appendChild(notification);
    void notification.offsetHeight;
    notification.classList.add('is-visible');
    setTimeout(() => {
      notification.classList.remove('is-visible');
      setTimeout(() => notification.remove(), 350);
    }, visibleDuration);
  };

  addNotification(`Welcome back, ${name}.`);
  if (showLowBalance) {
    setTimeout(() => {
      addNotification('Balance is low or at zero. Consider adjusting salary or reducing spending.', true, 3000);
    }, 1500);
  }
}

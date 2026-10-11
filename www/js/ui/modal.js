export function openModal(contentHtml, title = 'SalaryWise') {
  const root = document.getElementById('modal-root');
  if (!root) return null;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', title);

  backdrop.innerHTML = `
    <div class="modal" tabindex="0">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="icon-button" data-close-modal aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${contentHtml}</div>
    </div>
  `;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      backdrop.remove();
    }
  });

  const closeButton = backdrop.querySelector('[data-close-modal]');
  if (closeButton) {
    closeButton.addEventListener('click', () => backdrop.remove());
  }

  root.appendChild(backdrop);
  const modal = backdrop.querySelector('.modal');
  modal.focus();
  return backdrop;
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
}

export function confirmAction(title, message, onConfirm) {
  const html = `
    <p>${message}</p>
    <div class="button-row">
      <button class="secondary-btn" data-cancel>Cancel</button>
      <button class="danger-btn" data-confirm>Confirm</button>
    </div>
  `;
  const modal = openModal(html, title);
  modal.querySelector('[data-cancel]').addEventListener('click', () => modal.remove());
  modal.querySelector('[data-confirm]').addEventListener('click', () => {
    modal.remove();
    onConfirm();
  });
}

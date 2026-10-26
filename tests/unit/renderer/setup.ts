import '@testing-library/jest-dom/vitest';

// jsdom kent <dialog> wel, maar showModal() en close() niet (en het close-event ook niet)
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close')); // Chromium doet dit ook
  };
}

// jsdom heeft geen scrollIntoView
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

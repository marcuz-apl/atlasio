export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function toast(message, type = 'info', { timeout = 6000 } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div', `toast is-${type}`);
  node.append(icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info'));
  node.append(el('span', 'toast-message', message));
  const dismiss = () => {
    node.remove();
    clearTimeout(timer);
  };
  node.addEventListener('click', dismiss);
  host.append(node);
  const timer = setTimeout(dismiss, timeout);
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    const area = el('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (copyError) {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function setButtonBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent.trim();
    button.disabled = true;
    button.textContent = busyLabel;
    button.classList.add('is-busy');
  } else {
    button.disabled = false;
    if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
    button.classList.remove('is-busy');
  }
}

export function emptyState({ title, message, iconName = 'search' }) {
  const wrap = el('div', 'list-empty');
  wrap.append(el('strong', '', title));
  wrap.append(el('span', '', message));
  if (iconName) {
    const mark = el('span', 'empty-icon');
    mark.append(icon(iconName));
    wrap.prepend(mark);
  }
  return wrap;
}

export function skeletonRows(count = 6) {
  const wrap = el('div', 'skeleton-stack');
  for (let index = 0; index < count; index += 1) {
    wrap.append(el('div', 'skeleton skeleton-row'));
  }
  return wrap;
}

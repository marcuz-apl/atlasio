import { DOCS_HTML } from '../docs/content.js';
import { $, $$ } from '../lib/ui.js';

let initialized = false;
let sections = [];
let links = new Map();
let ticking = false;

export function initDocs() {
  const host = $('#docs-content');
  if (!host || initialized) return;
  initialized = true;

  host.innerHTML = DOCS_HTML;
  sections = $$('[data-doc-section]', host);
  buildToc(host);
  wireLinks(host);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
}

function buildToc(host) {
  const nav = $('#docs-toc-nav');
  if (!nav) return;
  nav.replaceChildren();

  sections.forEach((section, index) => {
    const heading = section.querySelector('h2');
    const link = document.createElement('a');
    link.href = '#/docs';
    link.dataset.docLink = section.id;
    link.setAttribute('aria-current', index === 0 ? 'location' : 'false');
    const number = document.createElement('span');
    number.textContent = String(index + 1).padStart(2, '0');
    number.className = 'docs-toc-number';
    link.append(number, document.createTextNode(heading?.textContent || section.id));
    nav.append(link);
    links.set(section.id, link);
  });
}

function wireLinks(host) {
  host.addEventListener('click', (event) => {
    const link = event.target.closest('[data-doc-link]');
    if (!link) return;
    event.preventDefault();
    scrollToSection(link.dataset.docLink);
  });

  $('#docs-toc-nav')?.addEventListener('click', (event) => {
    const link = event.target.closest('[data-doc-link]');
    if (!link) return;
    event.preventDefault();
    scrollToSection(link.dataset.docLink);
  });
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  setActive(id);
  history.replaceState(null, '', '#/docs');
}

function onScroll() {
  if ($('#view-docs')?.hidden) return;
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const offset = 200;
    let current = sections[0]?.id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= offset) current = section.id;
    }
    if (current) setActive(current);
  });
}

function setActive(id) {
  for (const [sectionId, link] of links) {
    link.setAttribute('aria-current', sectionId === id ? 'location' : 'false');
  }
}

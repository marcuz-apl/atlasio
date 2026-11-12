import { BUILD_DOCS_HTML } from '../docs/build.js';
import { USER_DOCS_HTML } from '../docs/user.js';
import { $, $$ } from '../lib/ui.js';

const VIEWS = {
  user: {
    html: USER_DOCS_HTML,
    eyebrow: 'ATLASIO / USER GUIDE',
    title: 'Using Atlasio',
    lede: 'Find governed subsurface data, inspect the evidence behind it, and move a package from ingest to publication.',
    audience: 'Viewers, importers, reviewers',
    scope: 'Release 1 · current workspace',
    evidence: 'Roles, workflows, and interface',
    route: '#/docs',
  },
  build: {
    html: BUILD_DOCS_HTML,
    eyebrow: 'ATLASIO / BUILD NOTES',
    title: 'Build notes & decisions',
    lede: 'How Atlasio is put together, what we chose not to compromise, and the evidence a future owner needs to extend it safely.',
    audience: 'Builders, maintainers, reviewers',
    scope: 'Release 1 · through v0.1.24',
    evidence: 'PRD, decision records, schema, release history',
    route: '#/admin/docs',
  },
};

let initialized = false;
let sections = [];
let links = new Map();
let ticking = false;
let routeBase = '#/docs';

export function initDocs() {
  const host = $('#docs-content');
  if (!host || initialized) return;
  initialized = true;

  wireLinks(host);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
}

export function renderDocs(kind) {
  const view = VIEWS[kind] || VIEWS.user;
  const host = $('#docs-content');
  if (!host) return;
  routeBase = view.route;

  host.innerHTML = view.html;
  sections = $$('[data-doc-section]', host);
  links = new Map();
  buildToc(host);

  const eyebrow = $('#docs-eyebrow');
  const title = $('#docs-title');
  const lede = $('#docs-lede');
  const audience = $('#docs-audience');
  const scope = $('#docs-scope');
  const evidence = $('#docs-evidence');
  const back = $('#docs-back-admin');
  if (eyebrow) eyebrow.textContent = view.eyebrow;
  if (title) title.textContent = view.title;
  if (lede) lede.textContent = view.lede;
  if (audience) audience.textContent = view.audience;
  if (scope) scope.textContent = view.scope;
  if (evidence) evidence.textContent = view.evidence;
  if (back) back.hidden = kind !== 'build';

  setActive(sections[0]?.id);
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
}

function buildToc(host) {
  const nav = $('#docs-toc-nav');
  if (!nav) return;
  nav.replaceChildren();

  sections.forEach((section, index) => {
    const heading = section.querySelector('h2');
    const link = document.createElement('a');
    link.href = routeBase;
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
  history.replaceState(null, '', routeBase);
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

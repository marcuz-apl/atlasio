import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { formatDateTime, shortId } from '../lib/format.js';
import { $, $$, el, icon, toast, emptyState, skeletonRows, setButtonBusy } from '../lib/ui.js';

let initialized = false;
let items = [];
let filter = 'active';

export function initReview({ onMutation } = {}) {
  if (initialized) return;
  initialized = true;

  $('#review-refresh')?.addEventListener('click', () => {
    loadReview({ announce: true });
  });

  $$('[data-review-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      filter = button.dataset.reviewFilter;
      $$('[data-review-filter]').forEach((node) => {
        node.classList.toggle('is-active', node === button);
      });
      renderReview();
    });
  });

  $('#review-list')?.addEventListener('click', async (event) => {
    const approve = event.target.closest('[data-approve]');
    const reject = event.target.closest('[data-reject]');
    if (!approve && !reject) return;

    const card = event.target.closest('.review-card');
    if (!card) return;
    const id = (approve || reject).dataset.approve || (approve || reject).dataset.reject;
    const resolution = card.querySelector('[data-resolution]');
    const reasonInput = card.querySelector('[data-review-reason]');
    const reason = (reasonInput?.value || '').trim();

    if (reject && !reason) {
      toast('A rejection reason is required.', 'error');
      reasonInput?.focus();
      return;
    }

    const buttons = card.querySelectorAll('button');
    buttons.forEach((button) => {
      button.disabled = true;
    });
    const active = approve || reject;
    setButtonBusy(active, true, approve ? 'Publishing…' : 'Rejecting…');

    try {
      const result = await api(`/imports/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision: approve ? 'approve' : 'reject',
          identity_resolution: approvalResolution(resolution, approve),
          reason: reason || null,
        }),
      });
      toast(
        approve
          ? `Published as version ${result.version_no ?? ''}.`.replace('  ', ' ')
          : 'Package rejected.',
        'success',
      );
      await loadReview();
      onMutation?.();
    } catch (error) {
      if (error.detail?.qc) {
        const item = items.find((entry) => entry.id === id);
        if (item) item.qc = error.detail.qc;
        renderReview();
      }
      toast(error.message, 'error');
    } finally {
      buttons.forEach((button) => {
        button.disabled = false;
      });
      setButtonBusy(active, false);
    }
  });
}

function approvalResolution(select, approving) {
  if (!approving) return null;
  return select?.value || 'new';
}

export async function loadReview({ announce = false } = {}) {
  if (state.role !== 'reviewer') return;
  const list = $('#review-list');
  if (list) list.replaceChildren(skeletonRows(3));
  try {
    items = await api('/imports');
    renderReview();
    if (announce) {
      const activeCount = items.filter((item) => item.status === 'submitted').length;
      toast(`Review queue refreshed · ${activeCount} awaiting review.`, 'success');
    }
  } catch (error) {
    if (list) {
      list.replaceChildren(emptyState({ title: 'Review queue unavailable', message: error.message, iconName: 'alert' }));
    }
    if (announce) toast(error.message, 'error');
  }
}

function renderReview() {
  const list = $('#review-list');
  if (!list) return;
  const activeCount = items.filter((item) => item.status === 'submitted').length;
  const title = $('#review-title');
  if (title) {
    title.replaceChildren(
      document.createTextNode('Review queue '),
      el('span', 'count-badge', String(activeCount)),
    );
  }

  const visible = filter === 'active' ? items.filter((item) => item.status === 'submitted') : items;
  list.replaceChildren();

  if (!visible.length) {
    list.append(
      emptyState({
        title: filter === 'active' ? 'Queue is clear' : 'No packages yet',
        message:
          filter === 'active'
            ? 'Submitted packages appear here for identity resolution and publication.'
            : 'Import packages appear here as importers stage them.',
        iconName: 'shield',
      }),
    );
    return;
  }

  for (const item of visible) {
    list.append(renderReviewCard(item));
  }
}

function renderReviewCard(item) {
  const manifest = item.manifest || {};
  const card = el('article', 'review-card');

  const head = el('div', 'review-card-head');
  const titleWrap = el('div');
  titleWrap.append(el('strong', '', manifest.name || 'Unnamed well'));
  titleWrap.append(
    el(
      'span',
      'review-card-sub',
      `${formatDateTime(item.created_at).toUpperCase()} · ${manifest.source || 'NO SOURCE'} · ${
        manifest.external_id ? `ID ${manifest.external_id}` : 'NO EXTERNAL ID'
      }`,
    ),
  );
  head.append(titleWrap, el('span', `status-pill is-${item.status}`, item.status));
  card.append(head);

  const grid = el('dl', 'review-grid');
  addGrid(grid, 'External ID', manifest.external_id || '—');
  addGrid(grid, 'Aliases', manifest.aliases?.length ? manifest.aliases.join(', ') : 'None');
  addGrid(grid, 'Source CRS', manifest.source_crs || 'Missing');
  addGrid(
    grid,
    'Source position',
    manifest.x !== undefined && manifest.x !== null ? `${manifest.x}, ${manifest.y}` : 'Missing',
  );
  addGrid(grid, 'License', manifest.license || 'Missing');
  addGrid(grid, 'Confidentiality', manifest.confidentiality || 'restricted');
  addGrid(grid, 'Download', manifest.download_allowed ? 'Permitted' : 'Not permitted');
  card.append(grid);

  const findings = (item.qc || []).filter((finding) => finding.severity !== 'info');
  if (findings.length) {
    const wrap = el('div', 'review-findings');
    for (const finding of findings) {
      const node = el('div', `finding ${finding.severity}`);
      node.append(icon(finding.severity === 'error' ? 'alert' : 'info'));
      node.append(document.createTextNode(finding.message));
      wrap.append(node);
    }
    card.append(wrap);
  }

  if (item.status === 'submitted') {
    const candidates = [
      ...new Set(
        findings
          .filter((finding) => finding.code === 'possible_duplicate' && finding.well_id)
          .map((finding) => finding.well_id),
      ),
    ];

    const actions = el('div', 'review-actions');

    const resolutionField = el('label', 'field');
    resolutionField.append(el('span', '', 'Identity resolution'));
    const select = el('select');
    select.dataset.resolution = '';
    select.append(new Option('Publish as a new well', 'new'));
    for (const candidate of candidates) {
      select.append(new Option(`New version of ${candidateName(candidate)}`, candidate));
    }
    resolutionField.append(select);
    actions.append(resolutionField);

    const reasonField = el('label', 'field');
    reasonField.append(el('span', '', 'Review note'));
    const reason = el('input');
    reason.type = 'text';
    reason.placeholder = 'Required to reject; optional to approve';
    reason.dataset.reviewReason = '';
    reasonField.append(reason);
    actions.append(reasonField);

    const buttons = el('div', 'review-buttons');
    const approve = el('button', 'btn btn-primary', 'Approve & publish');
    approve.type = 'button';
    approve.dataset.approve = item.id;
    const reject = el('button', 'btn btn-danger', 'Reject');
    reject.type = 'button';
    reject.dataset.reject = item.id;
    buttons.append(approve, reject);
    actions.append(buttons);
    card.append(actions);
  } else {
    if (item.review_reason) {
      const reason = el('p', 'review-reason');
      reason.textContent = `${item.reviewer || 'Reviewer'} · ${item.review_reason}`;
      card.append(reason);
    }
    if (item.status === 'published' && item.well_id) {
      const link = el('a', 'inline-link', 'Open published record');
      link.href = `#/workspace/explore?well=${item.well_id}`;
      link.append(icon('external'));
      card.append(link);
    }
  }

  return card;
}

function addGrid(list, term, value) {
  const wrap = el('div');
  wrap.append(el('dt', '', term), el('dd', '', value));
  list.append(wrap);
}

function candidateName(wellId) {
  const featureObject = state.wells.features.find((item) => item.properties.well_id === wellId);
  if (featureObject) return `${featureObject.properties.name} · ${shortId(wellId)}`;
  return `Well ${shortId(wellId)}`;
}

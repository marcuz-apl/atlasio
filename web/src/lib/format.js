const countFormat = new Intl.NumberFormat('en-US');
const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatCount = (value) => (Number.isFinite(value) ? countFormat.format(value) : '—');

export const roleLabel = (role) =>
  ({
    reader: 'Viewer',
    importer: 'Importer',
    reviewer: 'Reviewer',
    admin: 'Administrator',
    datamgr: 'Data Manager',
  })[role] || 'Not connected';

export const statusLabel = (status) =>
  ({ staged: 'Staged', submitted: 'Submitted', published: 'Published', rejected: 'Rejected' })[status] || status;

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortId(id, length = 8) {
  return id ? String(id).slice(0, length) : '—';
}

export function formatLat(lat) {
  if (!Number.isFinite(lat)) return '—';
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon) {
  if (!Number.isFinite(lon)) return '—';
  return `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export function formatPoint(longitude, latitude) {
  return `${formatLat(latitude)}  ${formatLon(longitude)}`;
}

export function formatCursor(lngLat) {
  return formatPoint(lngLat.lng, lngLat.lat);
}

export function joinList(values, fallback = 'None') {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values.join(', ');
}

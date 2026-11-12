import { state, setSession, updateAccount } from './state.js';

export class ApiError extends Error {
  constructor(message, detail = null, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.detail = detail;
    this.status = status;
  }
}

function messageFrom(detail, fallback) {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail.message === 'string') return detail.message;
  return fallback;
}

export function authHeaders() {
  if (state.session) return { 'X-Atlasio-Session': state.session };
  return { 'X-Atlasio-Key': state.key };
}

function expiredSession() {
  setSession('', null);
  state.role = null;
  window.dispatchEvent(new CustomEvent('atlasio:session-expired'));
}

export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new ApiError('The API is unreachable. Start the server and try again.', null, 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.session && !path.startsWith('/auth/')) expiredSession();
    const detail = data.detail ?? data;
    throw new ApiError(messageFrom(detail, `Request failed (${response.status})`), detail, response.status);
  }
  return data;
}

export async function login(username, password, code = '') {
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, code: code || undefined }),
  });
  setSession(result.session, result.account);
  return result;
}

export async function startMfa(currentPassword) {
  return api('/auth/mfa/start', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword }),
  });
}

export async function enableMfa(code) {
  const result = await api('/auth/mfa/enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  updateAccount(result.account);
  return result;
}

export async function disableMfa(currentPassword, code = '') {
  const result = await api('/auth/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, code: code || undefined }),
  });
  updateAccount(result.account);
  return result;
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    setSession('', null);
  }
}

export async function changePassword(currentPassword, newPassword) {
  const result = await api('/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  updateAccount(result.account);
  return result;
}

export async function downloadFile(fileId, fileName) {
  let response;
  try {
    response = await fetch(`/api/files/${fileId}`, {
      headers: authHeaders(),
    });
  } catch (error) {
    throw new ApiError('The API is unreachable. Start the server and try again.', null, 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(messageFrom(data.detail, 'The file could not be downloaded'), data.detail, response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'original-file';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

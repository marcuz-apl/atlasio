import { state } from './state.js';

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

export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'X-Atlasio-Key': state.key,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new ApiError('The API is unreachable. Start the server and try again.', null, 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail ?? data;
    throw new ApiError(messageFrom(detail, `Request failed (${response.status})`), detail, response.status);
  }
  return data;
}

export async function downloadFile(fileId, fileName) {
  let response;
  try {
    response = await fetch(`/api/files/${fileId}`, {
      headers: { 'X-Atlasio-Key': state.key },
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

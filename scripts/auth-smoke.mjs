import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const username = process.env.ATLASIO_ADMIN_USERNAME || 'admin';
const initial = process.env.ATLASIO_ADMIN_INITIAL_PASSWORD || 'admin-initial';
const password = process.env.ATLASIO_ADMIN_PASSWORD || 'atlasio-staff-ui-pass';

async function request(path, auth, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.session) headers['X-Atlasio-Session'] = auth.session;
  else if (auth?.key) headers['X-Atlasio-Key'] = auth.key;
  const response = await fetch(`${host}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  return { status: response.status, value };
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of text.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error(`Invalid base32 character ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
}

async function login(code) {
  return request('/auth/login', null, 'POST', { username, password, code });
}

let result = await login();
if (result.status !== 200) {
  const initialLogin = await request('/auth/login', null, 'POST', { username, password: initial });
  assert.equal(initialLogin.status, 200, `sign in: ${JSON.stringify(initialLogin.value)}`);
  const changed = await request('/auth/password', { session: initialLogin.value.session }, 'POST', {
    current_password: initial,
    new_password: password,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.value));
  result = await login();
}
assert.equal(result.status, 200, JSON.stringify(result.value));
let session = { session: result.value.session };
assert.equal(result.value.account.must_change_password, false);

const requiresMfa = process.env.ATLASIO_EXPECT_MFA_REQUIRED === '1';
if (requiresMfa) {
  assert.equal(result.value.account.mfa_required, true);
  assert.equal(result.value.account.must_enroll_mfa, true, 'a required deployment asks for enrolment');
  const blocked = await request('/admin/profiles', session, 'POST', {
    role: 'reader',
    label: `MFA gate ${Date.now()}`,
  });
  assert.equal(blocked.status, 403, 'privileged changes wait for MFA enrolment');
}

const wrongPassword = await request('/auth/mfa/start', session, 'POST', {
  current_password: 'not-the-password',
});
assert.equal(wrongPassword.status, 400, 'enrolment needs the current password');

const started = await request('/auth/mfa/start', session, 'POST', { current_password: password });
assert.equal(started.status, 200, JSON.stringify(started.value));
assert(started.value.secret.length >= 16);
assert(started.value.otpauth.startsWith('otpauth://totp/Atlasio%3A'));
assert(started.value.qr_svg.includes('<svg'));
const secret = started.value.secret;

const badEnable = await request('/auth/mfa/enable', session, 'POST', { code: '000000' });
assert.equal(badEnable.status, 401, 'a wrong enrolment code is rejected');

const enabled = await request('/auth/mfa/enable', session, 'POST', { code: totp(secret) });
assert.equal(enabled.status, 200, JSON.stringify(enabled.value));
assert.equal(enabled.value.recovery_codes.length, 8);
assert.equal(enabled.value.account.mfa_enabled, true);
const recovery = enabled.value.recovery_codes;
assert.match(recovery[0], /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

const me = await request('/me', session);
assert.equal(me.value.account.mfa_enabled, true);
if (requiresMfa) {
  const allowed = await request('/admin/profiles', session, 'POST', {
    role: 'reader',
    label: `MFA allowed ${Date.now()}`,
  });
  assert.equal(allowed.status, 200, 'enrolment unlocks privileged changes');
  await request(`/admin/profiles/${allowed.value.profile.id}`, session, 'PATCH', { active: false });
}

await request('/auth/logout', session, 'POST');
const withoutCode = await login();
assert.equal(withoutCode.status, 428, 'the password alone is not enough once MFA is on');
const wrongCode = await login('000000');
assert.equal(wrongCode.status, 401, 'a wrong authenticator code is rejected');

const withCode = await login(totp(secret));
assert.equal(withCode.status, 200, JSON.stringify(withCode.value));
session = { session: withCode.value.session };
assert.equal((await request('/admin/status', session)).status, 200, 'the MFA session can administer');

const recoveryLogin = await login(recovery[0]);
assert.equal(recoveryLogin.status, 200, 'a recovery code signs in once');
const reused = await login(recovery[0]);
assert.equal(reused.status, 401, 'a used recovery code cannot sign in again');

const badDisablePassword = await request('/auth/mfa/disable', session, 'POST', {
  current_password: 'not-the-password',
});
assert.equal(badDisablePassword.status, 400);
const badDisableCode = await request('/auth/mfa/disable', session, 'POST', {
  current_password: password,
  code: '000000',
});
assert.equal(badDisableCode.status, 401);
const disabled = await request('/auth/mfa/disable', session, 'POST', {
  current_password: password,
  code: totp(secret),
});
assert.equal(disabled.status, 200, JSON.stringify(disabled.value));
assert.equal(disabled.value.account.mfa_enabled, false);

const plainLogin = await login();
assert.equal(plainLogin.status, 200, 'sign-in returns to password-only after MFA is off');
assert.equal(plainLogin.value.account.mfa_enabled, false);

console.log('MFA enrolment, code challenge, recovery codes, disable, and password-only fallback passed.');

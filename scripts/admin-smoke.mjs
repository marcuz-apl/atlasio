import assert from 'node:assert/strict';

const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const adminUser = process.env.ATLASIO_ADMIN_USERNAME || 'admin';
const adminInitial = process.env.ATLASIO_ADMIN_INITIAL_PASSWORD || 'admin-initial';
const adminPassword = process.env.ATLASIO_ADMIN_PASSWORD || 'atlasio-staff-smoke-pass';
const datamgrUser = process.env.ATLASIO_DATAMGR_USERNAME || 'datamgr';
const datamgrInitial = process.env.ATLASIO_DATAMGR_INITIAL_PASSWORD || 'datamgr-initial';
const datamgrPassword = process.env.ATLASIO_DATAMGR_PASSWORD || 'atlasio-staff-smoke-pass';

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

// Sign in with the smoke password; fall back to the seeded initial password and
// change it once. The account keeps the changed password between runs.
async function signIn(username, initial, target) {
  let result = await request('/auth/login', null, 'POST', { username, password: target });
  if (result.status !== 200) {
    result = await request('/auth/login', null, 'POST', { username, password: initial });
    assert.equal(result.status, 200, `sign in as ${username}: ${JSON.stringify(result.value)}`);
  }
  const session = { session: result.value.session };
  if (result.value.account.must_change_password) {
    const changed = await request('/auth/password', session, 'POST', {
      current_password: initial,
      new_password: target,
    });
    assert.equal(changed.status, 200, `change the initial password: ${JSON.stringify(changed.value)}`);
    assert.equal(changed.value.account.must_change_password, false);
  }
  return session;
}

const gate = await (await fetch(`${host}/api/demo-profiles`)).json();
assert.equal(gate.length, 3, 'three demo profiles are published');
const readerKey = gate.find((profile) => profile.role === 'reader').key;

const wrong = await request('/auth/login', null, 'POST', {
  username: adminUser,
  password: 'definitely-not-the-password',
});
assert.equal(wrong.status, 401, 'a wrong password is rejected');

const admin = await signIn(adminUser, adminInitial, adminPassword);
const datamgr = await signIn(datamgrUser, datamgrInitial, datamgrPassword);

const me = await request('/me', admin);
assert.equal(me.status, 200);
assert.equal(me.value.role, 'admin');
assert.equal(me.value.account.username, adminUser);
assert.equal(me.value.account.must_change_password, false);

assert.equal((await request('/admin/status', { key: 'admin-demo' })).status, 401, 'shared admin keys are retired');
assert.equal((await request('/admin/status', admin)).status, 200);
assert.equal((await request('/admin/status', datamgr)).status, 200);
assert.equal((await request('/admin/status', { key: readerKey })).status, 403);
assert.equal((await request('/admin/profiles', { key: readerKey })).status, 403);
assert.equal((await request('/admin/changelog', { key: readerKey })).status, 403);

const status = await request('/admin/status', admin);
assert.equal(status.value.security.accounts, 2);
assert.equal(status.value.security.accounts_awaiting_password_change, 0);

const changelog = await request('/admin/changelog', datamgr);
assert.equal(changelog.status, 200, JSON.stringify(changelog.value));
assert(changelog.value.entries.length >= 19, 'the change log carries the release history');
assert.equal(changelog.value.entries[0].version, changelog.value.latest);
assert(changelog.value.entries.some((entry) => entry.version === '0.1.17'));
assert(changelog.value.entries.some((entry) => entry.highlights.length > 0));

const created = await request('/admin/profiles', datamgr, 'POST', {
  role: 'reader',
  label: `Smoke key ${Date.now()}`,
});
assert.equal(created.status, 200, JSON.stringify(created.value));
assert(created.value.key.startsWith('atl_'));
assert.equal((await request('/me', { key: created.value.key })).status, 200);
const profileId = created.value.profile.id;

const rotated = await request(`/admin/profiles/${profileId}/rotate`, datamgr, 'POST');
assert.equal(rotated.status, 200);
assert.equal((await request('/me', { key: created.value.key })).status, 401, 'rotated key stops working');
assert.equal((await request('/me', { key: rotated.value.key })).status, 200);

assert.equal((await request(`/admin/profiles/${profileId}`, datamgr, 'PATCH', { active: false })).status, 200);
assert.equal((await request('/me', { key: rotated.value.key })).status, 401, 'revoked key stops working');
assert.equal((await request(`/admin/profiles/${profileId}`, datamgr, 'PATCH', { active: true })).status, 200);
assert.equal((await request('/me', { key: rotated.value.key })).status, 200);

const demo = (await request('/admin/profiles', admin)).value.find(
  (profile) => profile.kind === 'demo' && profile.role === 'reader',
);
const rotatedDemo = await request(`/admin/profiles/${demo.id}/rotate`, datamgr, 'POST');
assert.equal(rotatedDemo.status, 200);
assert.notEqual(rotatedDemo.value.key, demo.demo_key);
assert.equal((await request('/me', { key: demo.demo_key })).status, 401);
assert.equal((await request('/me', { key: rotatedDemo.value.key })).status, 200);
const published = await (await fetch(`${host}/api/demo-profiles`)).json();
assert.equal(
  published.find((profile) => profile.role === 'reader').key,
  rotatedDemo.value.key,
  'the public gate publishes the rotated demo key',
);

const backup = await request('/admin/backups', datamgr, 'POST');
assert.equal(backup.status, 200, JSON.stringify(backup.value));
assert(backup.value.dump.sha256);
const backupId = backup.value.id;
assert((await request('/admin/backups', admin)).value.some((item) => item.id === backupId));

const verify = await request(`/admin/backups/${backupId}/verify`, datamgr, 'POST');
assert.equal(verify.status, 200, JSON.stringify(verify.value));
assert.equal(verify.value.valid, true);

const download = await fetch(`${host}/api/admin/backups/${backupId}/download`, {
  headers: { 'X-Atlasio-Session': datamgr.session },
});
assert.equal(download.status, 200);
assert.equal(
  Buffer.from(await download.arrayBuffer()).length,
  backup.value.dump.size_bytes,
  'download streams the whole dump',
);
const denied = await fetch(`${host}/api/admin/backups/${backupId}/download`, {
  headers: { 'X-Atlasio-Key': rotatedDemo.value.key },
});
assert.equal(denied.status, 403);
assert.equal((await request(`/admin/backups/${backupId}`, datamgr, 'DELETE')).status, 403);
assert.equal(
  (await request(`/admin/backups/${backupId}/restore`, datamgr, 'POST', { confirm: `RESTORE ${backupId}` })).status,
  403,
);
assert.equal(
  (await request(`/admin/backups/${backupId}/restore`, admin, 'POST', { confirm: 'RESTORE wrong' })).status,
  400,
);

const marker = await request('/admin/profiles', admin, 'POST', {
  role: 'reader',
  label: `RESTORE MARKER ${Date.now()}`,
});
assert.equal(marker.status, 200);

let maintenanceSeen = false;
const poll = setInterval(async () => {
  try {
    const response = await fetch(`${host}/api/wells/search?q=SYNTHETIC`, {
      headers: { 'X-Atlasio-Key': rotatedDemo.value.key },
    });
    if (response.status === 503) maintenanceSeen = true;
  } catch (error) {
    /* a paused server still counts as downtime, not a test failure */
  }
}, 600);

const restored = await request(`/admin/backups/${backupId}/restore`, admin, 'POST', {
  confirm: `RESTORE ${backupId}`,
});
clearInterval(poll);
assert.equal(restored.status, 200, JSON.stringify(restored.value));
assert(restored.value.pre_restore);
assert.equal(maintenanceSeen, true, 'non-admin requests are paused during the restore');

const after = await request('/admin/profiles', admin);
assert.equal(after.value.some((profile) => profile.label === marker.value.profile.label), false);
assert.equal(after.value.some((profile) => profile.id === profileId), true);
assert.equal((await request('/admin/status', admin)).value.maintenance, false);

await request(`/admin/profiles/${profileId}`, admin, 'PATCH', { active: false });
assert.equal((await request(`/admin/backups/${backupId}`, admin, 'DELETE')).status, 200);
assert.equal((await request(`/admin/backups/${restored.value.pre_restore}`, admin, 'DELETE')).status, 200);

const audit = await request('/admin/audit', datamgr);
assert(audit.value.some((entry) => entry.action === 'admin.backup.restore'));
assert(audit.value.some((entry) => entry.action === 'admin.profile.rotate'));

console.log('Admin profiles, demo-key rotation, backup, verify, download, restore rehearsal, maintenance block, change log, and audit passed.');

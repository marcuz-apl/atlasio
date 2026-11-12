import assert from 'node:assert/strict';

const host = process.env.ATLASIO_URL || 'http://localhost:8000';
const admin = process.env.ATLASIO_ADMIN_KEY || 'admin-demo';
const datamgr = process.env.ATLASIO_DATAMGR_KEY || 'datamgr-demo';

async function request(path, key, method = 'GET', body) {
  const response = await fetch(`${host}/api${path}`, {
    method,
    headers: { 'X-Atlasio-Key': key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  return { status: response.status, value };
}

const gate = await (await fetch(`${host}/api/demo-profiles`)).json();
assert.equal(gate.length, 3, 'three demo profiles are published');
const readerKey = gate.find((profile) => profile.role === 'reader').key;

assert.equal((await request('/admin/status', admin)).status, 200);
assert.equal((await request('/admin/status', datamgr)).status, 200);
assert.equal((await request('/admin/status', readerKey)).status, 403);
assert.equal((await request('/admin/profiles', readerKey)).status, 403);

const created = await request('/admin/profiles', datamgr, 'POST', {
  role: 'reader',
  label: `Smoke key ${Date.now()}`,
});
assert.equal(created.status, 200, JSON.stringify(created.value));
assert(created.value.key.startsWith('atl_'));
assert.equal((await request('/me', created.value.key)).status, 200);
const profileId = created.value.profile.id;

const rotated = await request(`/admin/profiles/${profileId}/rotate`, datamgr, 'POST');
assert.equal(rotated.status, 200);
assert.equal((await request('/me', created.value.key)).status, 401, 'rotated key stops working');
assert.equal((await request('/me', rotated.value.key)).status, 200);

assert.equal((await request(`/admin/profiles/${profileId}`, datamgr, 'PATCH', { active: false })).status, 200);
assert.equal((await request('/me', rotated.value.key)).status, 401, 'revoked key stops working');
assert.equal((await request(`/admin/profiles/${profileId}`, datamgr, 'PATCH', { active: true })).status, 200);
assert.equal((await request('/me', rotated.value.key)).status, 200);

const demo = (await request('/admin/profiles', admin)).value.find(
  (profile) => profile.kind === 'demo' && profile.role === 'reader',
);
const rotatedDemo = await request(`/admin/profiles/${demo.id}/rotate`, datamgr, 'POST');
assert.equal(rotatedDemo.status, 200);
assert.notEqual(rotatedDemo.value.key, demo.demo_key);
assert.equal((await request('/me', demo.demo_key)).status, 401);
assert.equal((await request('/me', rotatedDemo.value.key)).status, 200);
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
  headers: { 'X-Atlasio-Key': datamgr },
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

console.log('Admin profiles, demo-key rotation, backup, verify, download, restore rehearsal, maintenance block, and audit passed.');

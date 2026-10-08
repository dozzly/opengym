/* The module inside the real server.js: absent when off, signed-in only when on, and nothing of
 * its own on disk yet. Plus the server half of the data contract the module's plan delivery
 * stands on: a field the module puts on a routine or a custom exercise goes through PUT /api/data
 * and comes back from GET /api/data as it was sent. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.mjs';
import { MODULE_VERSION } from '../routes.js';

const UID = 'u_one';

test('TRAINER unset: /api/trainer/status is the plain 404 of a server without the module', async t => {
  const h = await startServer(t);
  for (const uid of [undefined, UID]) {
    const r = await h.call('GET', '/api/trainer/status', { uid });
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: 'not found' });
  }
  // The rest of the server is as it was.
  assert.equal((await h.call('GET', '/api/health')).status, 200);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'trainer')), false);
});

test('TRAINER=1: 401 without a session, the module version with one, and no store created yet', async t => {
  const h = await startServer(t, { env: { TRAINER: '1' } });
  let r = await h.call('GET', '/api/trainer/status');
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'not signed in' });
  r = await h.call('GET', '/api/trainer/status', { uid: UID });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enabled: true, module: MODULE_VERSION });
  // Only the routes the module registers exist: another method on the same path is still a 404.
  assert.equal((await h.call('POST', '/api/trainer/status', { uid: UID, body: {} })).status, 404);
  assert.equal((await h.call('GET', '/api/trainer/nothing-here', { uid: UID })).status, 404);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'trainer')), false);
});

// What a published assignment leaves on the client's own routines and custom exercises once the
// client's app has applied it (ADR 029, decision 5). Shape only; the module is not written yet.
const assigned = { by: 'u_trainer', assignmentId: 'as_1', rev: 3 };
const doc = () => ({
  _ts: 1000,
  routines: [
    { id: 'r_mine', name: 'My own', _ts: 900, ex: [{ id: '0001', sets: 3, reps: 10 }] },
    { id: 'r_coach', name: 'Assigned A', _ts: 1000, assigned, ex: [{ id: 'c_t1', sets: 3, reps: 8 }] }
  ],
  customEx: [{ id: 'c_t1', n: 'Trainer squat', bp: 'legs', eq: 'barbell', custom: true, _ts: 1000, assigned: { ...assigned, exId: 'tx_1' } }],
  week: { 1: ['r_coach'] }
});

test('PUT /api/data keeps the module\'s fields on routines and custom exercises, and GET returns them', async t => {
  const h = await startServer(t);
  const sent = doc();
  let r = await h.call('PUT', '/api/data', { uid: UID, body: { state: sent, baseRev: 0, stamped: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await h.call('GET', '/api/data', { uid: UID });
  assert.equal(r.status, 200);
  const got = r.body.state;
  assert.deepEqual(got.routines.find(x => x.id === 'r_coach').assigned, assigned);
  assert.equal('assigned' in got.routines.find(x => x.id === 'r_mine'), false);
  assert.deepEqual(got.customEx[0].assigned, { ...assigned, exId: 'tx_1' });

  // An app from before stamps (v1.3.9) or an API script writes the copy back without the field it
  // does not know: the server puts it back (sync-stamps.js keepUnknown), it does not drop it.
  const old = JSON.parse(JSON.stringify(got));
  delete old.routines.find(x => x.id === 'r_coach').assigned;
  delete old.customEx[0].assigned;
  old.routines.find(x => x.id === 'r_coach').name = 'Renamed by an older app';
  r = await h.call('PUT', '/api/data', { uid: UID, body: { state: old, baseRev: got._rev } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await h.call('GET', '/api/data', { uid: UID })).body.state;
  const routine = after.routines.find(x => x.id === 'r_coach');
  assert.equal(routine.name, 'Renamed by an older app');
  assert.deepEqual(routine.assigned, assigned, 'put back for a writer that does not stamp');
  assert.deepEqual(after.customEx[0].assigned, { ...assigned, exId: 'tx_1' });

  // The app itself (stamped: true) removing the field is a removal, and goes through.
  const mine = JSON.parse(JSON.stringify(after));
  delete mine.routines.find(x => x.id === 'r_coach').assigned;
  r = await h.call('PUT', '/api/data', { uid: UID, body: { state: mine, baseRev: after._rev, stamped: true } });
  assert.equal(r.status, 200);
  const last = (await h.call('GET', '/api/data', { uid: UID })).body.state;
  assert.equal('assigned' in last.routines.find(x => x.id === 'r_coach'), false);
});

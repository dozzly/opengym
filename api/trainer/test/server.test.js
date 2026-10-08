/* The module inside the real server.js, over HTTP: absent when off, every route of it included;
 * the FIT-003 acceptance flow with synthetic users; and the server half of the data contract the
 * module's plan delivery stands on (a field the module puts on a routine or a custom exercise goes
 * through PUT /api/data and comes back from GET /api/data as it was sent). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.mjs';
import { MODULE_VERSION } from '../routes.js';
import { parseExport } from '../library.js';
import { ROUTES } from './inproc.mjs';
import { exerciseBody, jpeg, mp4, programmeBody, sha, videoRef } from './samples.mjs';

const UID = 'u_one';
const ANNA = 'u_anna', BEA = 'u_bea', CAT = 'u_cat';
const PEOPLE = [{ id: ANNA, name: 'Anna Trainer' }, { id: BEA, name: 'Bea Other' }, { id: CAT, name: 'Cat Client' }];
const ON = { TRAINER: '1', MEDIA_MIN_FREE_MB: '0' };

test('TRAINER unset: every route of the module is the plain 404 of a server without it, /api/media/trainer included', async t => {
  const h = await startServer(t, { users: PEOPLE });
  const video = mp4();
  for (const key of ROUTES) {
    const [method, p] = key.split(' ');
    for (const uid of [undefined, ANNA]) {
      const r = p.startsWith('/api/media/')
        ? await h.raw(method, `${p}?hash=${sha(video)}`, { uid, ...(method === 'PUT' ? { bytes: video, mime: 'video/mp4' } : {}) })
        : await h.call(method, p, { uid, ...(method === 'GET' ? {} : { body: { baseRev: 0, enabled: true } }) });
      assert.equal(r.status, 404, `${key} as ${uid}`);
      assert.deepEqual(r.body, { error: 'not found' }, key);
    }
  }
  // The rest of the server is as it was.
  assert.equal((await h.call('GET', '/api/health')).status, 200);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'trainer')), false);
});

test('TRAINER=1: 401 without a session, the module version with one, and nothing created at boot', async t => {
  const h = await startServer(t, { env: ON });
  let r = await h.call('GET', '/api/trainer/status');
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'not signed in' });
  r = await h.call('GET', '/api/trainer/status', { uid: UID });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enabled: true, module: MODULE_VERSION });
  // Only the routes the module registers exist: another method on the same path is still a 404.
  assert.equal((await h.call('POST', '/api/trainer/status', { uid: UID, body: {} })).status, 404);
  assert.equal((await h.call('GET', '/api/trainer/nothing-here', { uid: UID })).status, 404);
  assert.equal((await h.call('GET', '/api/trainer/library/nothing-here', { uid: UID })).status, 404);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'trainer')), false);
});

test('with MEDIA_UPLOADS=0 the demo routes are absent too, and the library still works', async t => {
  const h = await startServer(t, { env: { ...ON, MEDIA_UPLOADS: '0' }, users: PEOPLE });
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: true } });
  assert.equal((await h.raw('GET', `/api/media/trainer?hash=${'a'.repeat(64)}`, { uid: ANNA })).status, 404);
  const lib = await h.call('GET', '/api/trainer/library', { uid: ANNA });
  assert.deepEqual([lib.status, lib.body.media], [200, null]);
});

/* ---------------------------------------------------------------- FIT-003 acceptance */

test('acceptance: one trainer, one exercise with a demo video, reused in two programmes, edited and archived', async t => {
  const h = await startServer(t, { env: ON, users: PEOPLE });
  // Bea is an ordinary self-managed profile with data of her own, which nothing here may touch.
  const beaState = { routines: [{ id: 'r_bea', name: 'Mine', ex: [{ id: '0025', sets: 3, reps: 8 }] }], workouts: [], weighIns: [{ d: '2026-10-01', w: 61.2 }] };
  assert.equal((await h.call('PUT', '/api/data', { uid: BEA, body: { state: beaState, baseRev: 0, stamped: true } })).status, 200);
  const beaFile = path.join(h.dataDir, `state-${BEA}.json`);
  const beaBefore = fs.readFileSync(beaFile);
  const dbBefore = fs.readFileSync(path.join(h.dataDir, 'db.json'));

  // 1. Anna switches trainer tools on. That grants her nothing over anyone.
  let r = await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: true } });
  assert.deepEqual([r.status, r.body], [200, { enabled: true, allowed: true }]);

  // 2. The demo: a video and its poster, uploaded through the media prefix.
  const video = mp4({ seconds: 6, bytes: 4000 }), poster = jpeg(800);
  for (const [bytes, mime] of [[video, 'video/mp4'], [poster, 'image/jpeg']]) {
    r = await h.raw('PUT', `/api/media/trainer?hash=${sha(bytes)}`, { uid: ANNA, bytes, mime });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const ref = videoRef(video, poster);

  // 3. One exercise with that demo, used by two programmes.
  r = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody({ media: ref }) } });
  assert.equal(r.status, 201);
  const ex = r.body.exercise;
  let rev = r.body.rev;
  const programmes = [];
  for (const name of ['Strength block', 'Hypertrophy block']) {
    r = await h.call('POST', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: rev, programme: programmeBody(name, [{ id: ex.id, sets: 3, reps: 8 }, { id: '0043', sets: 3, reps: 5, weight: 80 }]) } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    programmes.push(r.body.programme);
    rev = r.body.rev;
  }

  // 4. Edited: a new revision of the exercise, same id.
  r = await h.call('PUT', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: rev, id: ex.id, exercise: exerciseBody({ media: ref, desc: 'Keep the torso upright.' }) } });
  assert.deepEqual([r.status, r.body.exercise.id, r.body.exercise.rev], [200, ex.id, 2]);
  rev = r.body.rev;
  // A stale write (another tab still on the old revision) is a 409 carrying the current library.
  r = await h.call('PUT', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: rev - 1, id: ex.id, exercise: exerciseBody({ n: 'Stale tab' }) } });
  assert.deepEqual([r.status, r.body.rev, r.body.library.exercises[0].desc], [409, rev, 'Keep the torso upright.']);

  // 5. Archived.
  r = await h.call('DELETE', `/api/trainer/library/exercises?id=${ex.id}&baseRev=${rev}`, { uid: ANNA });
  assert.deepEqual([r.status, r.body.exercise.archived, r.body.exercise.rev], [200, true, 2]);
  rev = r.body.rev;

  // The programmes keep working: still there, still naming it, and still editable.
  r = await h.call('GET', '/api/trainer/library', { uid: ANNA });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.programmes.map(p => p.routines[0].ex[0].id), [ex.id, ex.id]);
  assert.equal(r.body.media.usage.count, 2);
  r = await h.call('PUT', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: rev, id: programmes[0].id, programme: { ...programmes[0], name: 'Strength block 2' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  rev = r.body.rev;

  // The demo stays fetchable by the trainer, with upstream's hardened headers.
  r = await h.raw('GET', `/api/media/trainer?hash=${sha(video)}`, { uid: ANNA });
  assert.equal(r.status, 200);
  assert.deepEqual(r.bytes, video);
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');

  // 6. Another user can read neither the library nor the demo.
  for (const uid of [BEA, CAT]) {
    assert.equal((await h.call('GET', '/api/trainer/library', { uid })).status, 403);
    assert.equal((await h.call('GET', '/api/trainer/library/export', { uid })).status, 403);
  }
  assert.equal((await h.call('GET', '/api/trainer/library')).status, 401);
  const missing = await h.raw('GET', `/api/media/trainer?hash=${'e'.repeat(64)}`, { uid: BEA });
  for (const q of ['', `&trainer=${ANNA}`]) {
    r = await h.raw('GET', `/api/media/trainer?hash=${sha(video)}${q}`, { uid: BEA });
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, missing.body, 'as missing, not 403');
    assert.deepEqual(r.body, { error: 'no such file', code: 'media-missing' });
  }
  // Upstream's own media route is per profile: Anna's demo is not Bea's file, nor Anna's upload.
  assert.equal((await h.raw('GET', `/api/media/${sha(video)}`, { uid: ANNA })).status, 404);
  assert.equal((await h.raw('GET', `/api/media/${sha(video)}`, { uid: BEA })).status, 404);

  // Switching tools on gives Bea her own empty library and still nothing of Anna's.
  await h.call('POST', '/api/trainer/capability', { uid: BEA, body: { enabled: true } });
  r = await h.call('GET', '/api/trainer/library', { uid: BEA });
  assert.deepEqual([r.status, r.body.owner, r.body.exercises, r.body.programmes], [200, BEA, [], []]);
  assert.deepEqual((await h.raw('GET', `/api/media/trainer?hash=${sha(video)}&trainer=${ANNA}`, { uid: BEA })).body, missing.body);

  // 7. Export round-trips.
  r = await h.call('GET', '/api/trainer/library/export', { uid: ANNA });
  const lib = (await h.call('GET', '/api/trainer/library', { uid: ANNA })).body;
  assert.deepEqual(parseExport(JSON.stringify(r.body)), { exercises: lib.exercises, programmes: lib.programmes });

  // Nothing of upstream's was written: Bea's state and db.json are byte for byte as they were
  // (Anna's sign-in leaves db.json alone), and DATA_DIR/uploads was never created.
  assert.deepEqual(fs.readFileSync(beaFile), beaBefore);
  assert.deepEqual(fs.readFileSync(path.join(h.dataDir, 'db.json')), dbBefore);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'uploads')), false);
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${ANNA}.json`)), false);
  // Everything the module wrote is under DATA_DIR/trainer/, with upstream's modes.
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? tree(path.join(dir, d.name)).map(n => `${d.name}/${n}`) : [d.name]));
  assert.deepEqual(tree(path.join(h.dataDir, 'trainer')).filter(n => !n.endsWith('.gc.json')).sort(), [
    'capabilities.json', `library/${ANNA}.json`, `media/${ANNA}/${sha(poster)}.jpg`, `media/${ANNA}/${sha(video)}.mp4`
  ].sort());
  const mode = p => fs.statSync(p).mode & 0o777;
  assert.equal(mode(path.join(h.dataDir, 'trainer', 'library', `${ANNA}.json`)), mode(beaFile));
  assert.equal(mode(path.join(h.dataDir, 'trainer', 'media', ANNA)), 0o700);

  // The audit log: who did what to which id, never names, instructions or bytes.
  const events = h.audit().filter(e => e.ev.startsWith('trainer.'));
  assert.deepEqual(events.map(e => e.ev), [
    'trainer.capability', 'trainer.media.upload', 'trainer.media.upload', 'trainer.exercise.create',
    'trainer.programme.create', 'trainer.programme.create', 'trainer.exercise.update', 'trainer.exercise.archive',
    'trainer.programme.update', 'trainer.media.denied', 'trainer.capability', 'trainer.media.denied'
  ]);
  const text = JSON.stringify(events);
  for (const secret of ['Anna Trainer', 'Bea Other', 'Split squat', 'torso', 'Front shin', 'Strength block', 'Hypertrophy', 'Day 1']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.ok(events.every(e => e.uid && !('name' in e)));
});

test('acceptance: the demo quota is enforced, per trainer, with upstream\'s answer', async t => {
  const h = await startServer(t, { env: { ...ON, TRAINER_MEDIA_QUOTA_MB: String(5000 / 1048576) }, users: PEOPLE });
  for (const uid of [ANNA, BEA]) await h.call('POST', '/api/trainer/capability', { uid, body: { enabled: true } });
  const a = mp4({ bytes: 4000 }), b = mp4({ bytes: 4000 });
  assert.equal((await h.raw('PUT', `/api/media/trainer?hash=${sha(a)}`, { uid: ANNA, bytes: a, mime: 'video/mp4' })).status, 201);
  const over = await h.raw('PUT', `/api/media/trainer?hash=${sha(b)}`, { uid: ANNA, bytes: b, mime: 'video/mp4' });
  assert.equal(over.status, 413);
  assert.equal(over.body.code, 'media-quota');
  assert.equal(over.body.error, 'your space for photos and videos is full');
  // Bea's quota is her own.
  assert.equal((await h.raw('PUT', `/api/media/trainer?hash=${sha(b)}`, { uid: BEA, bytes: b, mime: 'video/mp4' })).status, 201);
  // Signed out and switched off are refused before a byte is stored.
  assert.equal((await h.raw('PUT', `/api/media/trainer?hash=${sha(b)}`, { bytes: b, mime: 'video/mp4' })).status, 401);
  assert.equal((await h.raw('PUT', `/api/media/trainer?hash=${sha(b)}`, { uid: CAT, bytes: b, mime: 'video/mp4' })).status, 403);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'trainer', 'media', CAT)), false);
});

test('acceptance: switching trainer tools on grants nothing, and off keeps the library but refuses writes', async t => {
  const h = await startServer(t, { env: { ...ON, TRAINER_ALLOW: `${ANNA},${BEA}` }, users: PEOPLE });
  assert.deepEqual((await h.call('GET', '/api/trainer/capability', { uid: CAT })).body, { enabled: false, allowed: false });
  assert.equal((await h.call('POST', '/api/trainer/capability', { uid: CAT, body: { enabled: true } })).status, 403);
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: true } });
  const made = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody() } });
  assert.equal(made.status, 201);
  // What switching on wrote: one flag for Anna, and no grant, link or reference to anyone else.
  const caps = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'trainer', 'capabilities.json'), 'utf8'));
  assert.deepEqual(Object.keys(caps.users), [ANNA]);
  assert.deepEqual(Object.keys(caps.users[ANNA]).sort(), ['at', 'enabled']);
  // No route reads another profile: the only ones that take a user id at all are the demo GET,
  // whose answer for anyone but the owner is "missing".
  for (const uid of [BEA, CAT]) assert.equal((await h.call('GET', '/api/trainer/library', { uid })).status, 403);
  assert.equal((await h.call('GET', '/api/data', { uid: ANNA })).body.state, null, 'Anna\'s own (empty) profile, as before');

  // Switched off: the library stays on disk untouched, reads and writes are refused.
  const file = path.join(h.dataDir, 'trainer', 'library', `${ANNA}.json`);
  const before = fs.readFileSync(file);
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: false } });
  const w = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 1, exercise: exerciseBody() } });
  assert.deepEqual([w.status, w.body.code], [403, 'trainer-off']);
  assert.deepEqual(fs.readFileSync(file), before);
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: true } });
  assert.deepEqual((await h.call('GET', '/api/trainer/library', { uid: ANNA })).body.exercises, [made.body.exercise]);
});

test('acceptance: a corrupt or missing store never deletes anything and is never replaced', async t => {
  const h = await startServer(t, { env: ON, users: PEOPLE });
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: true } });
  await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody() } });
  const file = path.join(h.dataDir, 'trainer', 'library', `${ANNA}.json`);
  fs.writeFileSync(file, '{"v":1,"rev":1,');
  for (const [m, p, body] of [['GET', '/api/trainer/library'], ['POST', '/api/trainer/library/exercises', { baseRev: 0, exercise: exerciseBody() }], ['POST', '/api/trainer/library/exercises', { baseRev: 1, exercise: exerciseBody() }]]) {
    assert.equal((await h.call(m, p, { uid: ANNA, body })).status, 503, `${m} ${p}`);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1,"rev":1,');
  // A damaged capabilities file: nobody is on, and switching on does not replace it.
  const caps = path.join(h.dataDir, 'trainer', 'capabilities.json');
  fs.writeFileSync(caps, 'garbage');
  assert.equal((await h.call('GET', '/api/trainer/library', { uid: ANNA })).status, 403);
  assert.equal((await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: true } })).status, 503);
  assert.equal(fs.readFileSync(caps, 'utf8'), 'garbage');
  // A missing store: an empty library, and the next write starts it.
  fs.rmSync(path.join(h.dataDir, 'trainer'), { recursive: true });
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: true } });
  assert.deepEqual((await h.call('GET', '/api/trainer/library', { uid: ANNA })).body.exercises, []);
});

/* ---------------------------------------------------------------- the data contract */

// What a published assignment leaves on the client's own routines and custom exercises once the
// client's app has applied it (ADR 029, decision 5; frontend/src/trainer/snapshot.js).
const assigned = { by: 'u_trainer', assignmentId: 'as_1', rev: 3 };
const src = { trainer: 'u_trainer', exRev: 2 };
const doc = () => ({
  _ts: 1000,
  routines: [
    { id: 'r_mine', name: 'My own', _ts: 900, ex: [{ id: '0001', sets: 3, reps: 10 }] },
    { id: 'tr_coach', name: 'Assigned A', _ts: 1000, assigned, ex: [{ id: 'tx_0123456789abcdef', sets: 3, reps: 8 }] }
  ],
  customEx: [{ id: 'tx_0123456789abcdef', n: 'Trainer squat', bp: 'legs', eq: 'barbell', custom: true, _ts: 1000, src }],
  week: { 1: ['tr_coach'] }
});

test('PUT /api/data keeps the module\'s fields on routines and custom exercises, and GET returns them', async t => {
  const h = await startServer(t);
  const sent = doc();
  let r = await h.call('PUT', '/api/data', { uid: UID, body: { state: sent, baseRev: 0, stamped: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await h.call('GET', '/api/data', { uid: UID });
  assert.equal(r.status, 200);
  const got = r.body.state;
  assert.deepEqual(got.routines.find(x => x.id === 'tr_coach').assigned, assigned);
  assert.equal('assigned' in got.routines.find(x => x.id === 'r_mine'), false);
  assert.deepEqual(got.customEx[0].src, src);

  // An app from before stamps (v1.3.9) or an API script writes the copy back without the field it
  // does not know: the server puts it back (sync-stamps.js keepUnknown), it does not drop it.
  const old = JSON.parse(JSON.stringify(got));
  delete old.routines.find(x => x.id === 'tr_coach').assigned;
  delete old.customEx[0].src;
  old.routines.find(x => x.id === 'tr_coach').name = 'Renamed by an older app';
  r = await h.call('PUT', '/api/data', { uid: UID, body: { state: old, baseRev: got._rev } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await h.call('GET', '/api/data', { uid: UID })).body.state;
  const routine = after.routines.find(x => x.id === 'tr_coach');
  assert.equal(routine.name, 'Renamed by an older app');
  assert.deepEqual(routine.assigned, assigned, 'put back for a writer that does not stamp');
  assert.deepEqual(after.customEx[0].src, src);

  // The app itself (stamped: true) removing the field is a removal, and goes through.
  const mine = JSON.parse(JSON.stringify(after));
  delete mine.routines.find(x => x.id === 'tr_coach').assigned;
  r = await h.call('PUT', '/api/data', { uid: UID, body: { state: mine, baseRev: after._rev, stamped: true } });
  assert.equal(r.status, 200);
  const last = (await h.call('GET', '/api/data', { uid: UID })).body.state;
  assert.equal('assigned' in last.routines.find(x => x.id === 'tr_coach'), false);
});

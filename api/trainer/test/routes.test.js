/* The route factory: off unless TRAINER says on, the helpers it needs, and every route's answers,
 * in-process against stand-ins for server.js's helpers (inproc.mjs). The real server.js is in
 * server.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { trainerRoutes, trainerEnabled, storeDir, MODULE_VERSION } from '../routes.js';
import { EX_ID_RE, PROG_ID_RE } from '../library.js';
import { harness, ROUTES } from './inproc.mjs';
import { exerciseBody, jpeg, mp4, programmeBody, sha, videoRef } from './samples.mjs';

const ANNA = 'u_anna', BEA = 'u_bea';

test('off unless TRAINER is set: no routes at all, so the server answers its plain 404', () => {
  for (const TRAINER of [undefined, '', '0', 'false', 'off', 'no', 'trainer']) {
    assert.deepEqual(trainerRoutes({}, { TRAINER }), {}, `TRAINER=${TRAINER}`);
    assert.equal(trainerEnabled({ TRAINER }), false);
  }
  // Off, it does not even look at the helpers: an upstream change to them cannot stop a server
  // that does not run the module.
  assert.deepEqual(trainerRoutes(undefined, {}), {});
});

test('on with 1, true, yes or on: these routes and no others; the media pair only with uploads on', t => {
  for (const TRAINER of ['1', 'true', 'TRUE', 'yes', 'on']) {
    const h = harness(t, { env: { TRAINER } });
    assert.deepEqual(Object.keys(h.routes).sort(), [...ROUTES].sort(), `TRAINER=${TRAINER}`);
  }
  const off = harness(t, { env: { MEDIA_UPLOADS: '0' } });
  assert.deepEqual(Object.keys(off.routes).sort(), ROUTES.filter(k => !k.includes('/api/media/')).sort());
  assert.equal(off.internals.demo, null);
});

test('every route is keyed the way server.js looks routes up, under /api/trainer/ or the media prefix', t => {
  for (const key of Object.keys(harness(t).routes)) {
    assert.match(key, /^(GET|POST|PUT|DELETE) \/api\/(trainer\/[a-z0-9/-]+|media\/trainer)$/);
    // Never something the dispatcher's one pattern route would take: /api/media/<64 hex>.
    assert.doesNotMatch(key, /\/api\/media\/[0-9a-f]{64}$/);
  }
});

test('switched on, a helper server.js stopped passing stops the boot with its name', t => {
  const h = harness(t);
  const { readSession, ...rest } = h.helpers;
  assert.throws(() => trainerRoutes(rest, { TRAINER: '1' }), /no longer passes readSession/);
  assert.throws(() => trainerRoutes({ ...h.helpers, dataDir: '' }, { TRAINER: '1' }), /no longer passes dataDir/);
  assert.throws(() => trainerRoutes({ json() {} }, { TRAINER: '1' }), /no longer passes .*audit.*sendMediaFile/);
});

test('its own store is DATA_DIR/trainer, beside the files upstream owns, and nothing is created at boot', t => {
  assert.equal(storeDir('/data'), '/data/trainer');
  const h = harness(t);
  assert.equal(fs.existsSync(path.join(h.dir, 'trainer')), false);
});

test('GET /api/trainer/status: 401 without a session, the module version with one', async t => {
  const h = harness(t);
  assert.deepEqual(await h.call('GET', '/api/trainer/status'), { status: 401, body: { error: 'not signed in' }, headers: {} });
  assert.deepEqual((await h.call('GET', '/api/trainer/status', { uid: ANNA })).body, { enabled: true, module: MODULE_VERSION });
  assert.equal(MODULE_VERSION, '0.2.0');
});

test('capability: self-service, off by default, refused outside TRAINER_ALLOW, recorded without content', async t => {
  const h = harness(t, { env: { TRAINER_ALLOW: 'u_anna' } });
  assert.equal((await h.call('GET', '/api/trainer/capability')).status, 401);
  assert.deepEqual((await h.call('GET', '/api/trainer/capability', { uid: ANNA })).body, { enabled: false, allowed: true });
  assert.deepEqual((await h.call('GET', '/api/trainer/capability', { uid: BEA })).body, { enabled: false, allowed: false });
  assert.equal((await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: 'yes' } })).status, 400);
  assert.deepEqual((await h.on(ANNA)).body, { enabled: true, allowed: true });
  const refused = await h.on(BEA);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'not-allowed');
  assert.deepEqual(h.audits, [
    { ev: 'trainer.capability', uid: ANNA, msg: 'on', ok: true },
    { ev: 'trainer.capability', uid: BEA, msg: 'refused: not in TRAINER_ALLOW', ok: false }
  ]);
  await h.on(ANNA);
  assert.equal(h.audits.length, 2, 'switching on what is on records nothing');
});

test('the library routes need a session (401) and trainer tools on (403); a write refused for that is audited', async t => {
  const h = harness(t);
  for (const key of ROUTES.filter(k => k.includes('/library'))) {
    const [method, p] = key.split(' ');
    const body = method === 'GET' ? undefined : { baseRev: 0, exercise: exerciseBody(), programme: programmeBody('P', []) };
    assert.equal((await h.call(method, p, { body })).status, 401, key);
    const off = await h.call(method, p, { uid: BEA, body });
    assert.equal(off.status, 403, key);
    assert.equal(off.body.code, 'trainer-off');
  }
  assert.deepEqual([...new Set(h.audits.map(e => e.ev))].sort(), ['trainer.exercise.denied', 'trainer.programme.denied']);
  assert.ok(h.audits.every(e => e.uid === BEA && e.ok === false));
  assert.equal(fs.existsSync(path.join(h.dir, 'trainer')), false, 'nothing written for anyone');
});

test('exercises: create (rev 1), edit (rev++ on a content change only), archive and restore, with stable ids', async t => {
  const h = harness(t);
  await h.on(ANNA);
  const lib = async () => (await h.call('GET', '/api/trainer/library', { uid: ANNA })).body;
  assert.deepEqual((await lib()).exercises, []);
  assert.equal((await lib()).owner, ANNA);

  const made = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: { ...exerciseBody(), id: 'tx_' + 'f'.repeat(16), rev: 99, archived: true, extra: 1 } } });
  assert.equal(made.status, 201);
  const ex = made.body.exercise;
  assert.match(ex.id, EX_ID_RE);
  assert.notEqual(ex.id, 'tx_' + 'f'.repeat(16), 'ids are the server\'s');
  assert.deepEqual([ex.rev, ex.archived, made.body.rev, 'extra' in ex], [1, false, 1, false]);

  // Same content again: no new revision of anything.
  let r = await h.call('PUT', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 1, id: ex.id, exercise: exerciseBody() } });
  assert.deepEqual([r.status, r.body.rev, r.body.exercise.rev], [200, 1, 1]);
  r = await h.call('PUT', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 1, id: ex.id, exercise: exerciseBody({ desc: 'Knee tracks the toes.' }) } });
  assert.deepEqual([r.status, r.body.rev, r.body.exercise.rev, r.body.exercise.id], [200, 2, 2, ex.id]);

  r = await h.call('DELETE', `/api/trainer/library/exercises?id=${ex.id}&baseRev=2`, { uid: ANNA });
  assert.deepEqual([r.status, r.body.exercise.archived, r.body.exercise.rev], [200, true, 2], 'archiving is no content change');
  r = await h.call('DELETE', '/api/trainer/library/exercises', { uid: ANNA, body: { id: ex.id, baseRev: 3 } });
  assert.deepEqual([r.status, r.body.rev], [200, 3], 'archiving the archived: nothing to write');
  r = await h.call('PUT', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 3, id: ex.id, exercise: exerciseBody({ desc: 'Knee tracks the toes.' }), archived: false } });
  assert.deepEqual([r.status, r.body.exercise.archived, r.body.exercise.rev], [200, false, 2]);

  assert.equal((await h.call('PUT', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 4, id: 'tx_' + '0'.repeat(16), exercise: exerciseBody() } })).status, 404);
  assert.equal((await h.call('DELETE', '/api/trainer/library/exercises?id=nope&baseRev=4', { uid: ANNA })).status, 404);
  const invalid = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 4, exercise: exerciseBody({ n: '' }) } });
  assert.deepEqual([invalid.status, invalid.body.code, invalid.body.field], [400, 'invalid', 'n']);
  assert.equal((await lib()).rev, 4, 'refusals write nothing');

  // What the audit log holds: ids and counts, never the name or the instructions.
  const evs = h.audits.map(e => e.ev);
  assert.deepEqual(evs, ['trainer.capability', 'trainer.exercise.create', 'trainer.exercise.update', 'trainer.exercise.archive', 'trainer.exercise.restore', 'trainer.exercise.refused', 'trainer.exercise.refused', 'trainer.exercise.refused']);
  const text = JSON.stringify(h.audits);
  assert.doesNotMatch(text, /Split squat|Knee tracks|Front shin|Name of/);
  assert.match(text, new RegExp(ex.id));
});

test('a stale baseRev is a 409 with the current library, and writes nothing; no baseRev is a 400', async t => {
  const h = harness(t);
  await h.on(ANNA);
  const one = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody() } });
  for (const [method, p, body] of [
    ['POST', '/api/trainer/library/exercises', { baseRev: 0, exercise: exerciseBody({ n: 'From an old tab' }) }],
    ['PUT', '/api/trainer/library/exercises', { baseRev: 0, id: one.body.exercise.id, exercise: exerciseBody({ n: 'Stale' }) }],
    ['DELETE', `/api/trainer/library/exercises?id=${one.body.exercise.id}&baseRev=0`],
    ['POST', '/api/trainer/library/programmes', { baseRev: 0, programme: programmeBody('P', []) }],
    ['PUT', '/api/trainer/library/exercises', { baseRev: 1, baseWid: '0'.repeat(16), id: one.body.exercise.id, exercise: exerciseBody({ n: 'Other wid' }) }]
  ]) {
    const r = await h.call(method, p, { uid: ANNA, body });
    assert.equal(r.status, 409, `${method} ${p}`);
    assert.equal(r.body.code, 'conflict');
    assert.equal(r.body.rev, 1);
    assert.deepEqual(r.body.library.exercises, [one.body.exercise]);
  }
  for (const body of [{ exercise: exerciseBody() }, { baseRev: '1', exercise: exerciseBody() }, { baseRev: -1, exercise: exerciseBody() }]) {
    assert.equal((await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body })).status, 400);
  }
  assert.equal((await h.call('GET', '/api/trainer/library', { uid: ANNA })).body.rev, 1);
});

test('programmes: create and edit with library and built-in slots; an archived exercise stays in the programmes that had it', async t => {
  const h = harness(t);
  await h.on(ANNA);
  const ex = (await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody() } })).body.exercise;
  const slots = [{ id: ex.id, sets: 3, reps: 8 }, { id: '0043', sets: 3, reps: 5, weight: 100 }];
  const p1 = await h.call('POST', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: 1, programme: programmeBody('Block A', slots) } });
  assert.equal(p1.status, 201);
  assert.match(p1.body.programme.id, PROG_ID_RE);
  assert.deepEqual(p1.body.programme.routines[0].ex[1], { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 100 });
  const p2 = await h.call('POST', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: 2, programme: programmeBody('Block B', [{ id: ex.id, sets: 5, reps: 5 }]) } });
  assert.equal(p2.status, 201);

  await h.call('DELETE', `/api/trainer/library/exercises?id=${ex.id}&baseRev=3`, { uid: ANNA });
  // Block A still saves with its archived exercise (a rename, say) …
  const edited = await h.call('PUT', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: 4, id: p1.body.programme.id, programme: { ...programmeBody('Block A, renamed', slots) } } });
  assert.deepEqual([edited.status, edited.body.programme.rev], [200, 2]);
  // … but a programme that did not use it cannot start to.
  const added = await h.call('PUT', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: 5, id: p2.body.programme.id, programme: programmeBody('Block B', [{ id: ex.id }], [{ id: ex.id }]) } });
  assert.equal(added.status, 200, 'Block B already used it, in any routine');
  const fresh = await h.call('POST', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: 6, programme: programmeBody('Block C', [{ id: ex.id }]) } });
  assert.deepEqual([fresh.status, fresh.body.code], [400, 'archived-exercise']);
  const unknown = await h.call('POST', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: 6, programme: programmeBody('Block C', [{ id: 'tx_' + '9'.repeat(16) }]) } });
  assert.deepEqual([unknown.status, unknown.body.code], [400, 'unknown-exercise']);

  const arch = await h.call('DELETE', '/api/trainer/library/programmes', { uid: ANNA, body: { id: p2.body.programme.id, baseRev: 6 } });
  assert.deepEqual([arch.status, arch.body.programme.archived], [200, true]);
  const lib = (await h.call('GET', '/api/trainer/library', { uid: ANNA })).body;
  assert.equal(lib.programmes.length, 2);
  assert.equal(lib.exercises[0].archived, true);
  assert.deepEqual(h.audits.filter(e => e.ev.startsWith('trainer.programme.') && e.ok).map(e => e.ev),
    ['trainer.programme.create', 'trainer.programme.create', 'trainer.programme.update', 'trainer.programme.update', 'trainer.programme.archive']);
  assert.doesNotMatch(JSON.stringify(h.audits), /Block|Day 1/);
});

test('the library is per trainer: a second trainer sees and changes only their own', async t => {
  const h = harness(t);
  await h.on(ANNA);
  await h.on(BEA);
  const ex = (await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody() } })).body.exercise;
  const bea = (await h.call('GET', '/api/trainer/library', { uid: BEA })).body;
  assert.deepEqual([bea.owner, bea.rev, bea.exercises], [BEA, 0, []]);
  assert.equal((await h.call('PUT', '/api/trainer/library/exercises', { uid: BEA, body: { baseRev: 0, id: ex.id, exercise: exerciseBody({ n: 'Mine now' }) } })).status, 404);
  assert.equal((await h.call('DELETE', `/api/trainer/library/exercises?id=${ex.id}&baseRev=0`, { uid: BEA })).status, 404);
  assert.equal((await h.call('POST', '/api/trainer/library/programmes', { uid: BEA, body: { baseRev: 0, programme: programmeBody('P', [{ id: ex.id }]) } })).body.code, 'unknown-exercise');
  assert.equal((await h.call('GET', '/api/trainer/library', { uid: ANNA })).body.exercises[0].n, exerciseBody().n);
});

test('export: the trainer\'s library as portable JSON, served as a download', async t => {
  const h = harness(t);
  await h.on(ANNA);
  const video = mp4(), poster = jpeg();
  const ex = (await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody({ media: videoRef(video, poster) }) } })).body.exercise;
  const r = await h.call('GET', '/api/trainer/library/export', { uid: ANNA });
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Disposition'], /^attachment; filename="opengym-trainer-library\.json"$/);
  assert.equal(r.body.opengym_trainer_library, 1);
  assert.equal(r.body.module, MODULE_VERSION);
  assert.deepEqual(r.body.exercises, [ex]);
  assert.equal(r.body.exercises[0].media.hash, sha(video));
  assert.doesNotMatch(JSON.stringify(r.body), new RegExp(ANNA));
});

test('a library file that cannot be read: reads answer 503, writes answer 503, and the file is left alone', async t => {
  const h = harness(t);
  await h.on(ANNA);
  await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody() } });
  const file = path.join(h.dir, 'trainer', 'library', `${ANNA}.json`);
  fs.writeFileSync(file, '{"v":1,"rev":1,"exer');
  for (const [m, p, body] of [['GET', '/api/trainer/library'], ['GET', '/api/trainer/library/export'],
    ['POST', '/api/trainer/library/exercises', { baseRev: 1, exercise: exerciseBody() }], ['POST', '/api/trainer/library/exercises', { baseRev: 0, exercise: exerciseBody() }]]) {
    const r = await h.call(m, p, { uid: ANNA, body });
    assert.deepEqual([r.status, r.body.code], [503, 'unreadable'], `${m} ${p}`);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1,"rev":1,"exer');
});

test('uploads: signed in (401), trainer tools on (403, audited), the hash in the query; answers with the usage', async t => {
  const h = harness(t);
  const video = mp4();
  const put = uid => h.call('PUT', `/api/media/trainer?hash=${sha(video)}`, { uid, upload: { bytes: video, mime: 'video/mp4' } });
  assert.equal((await put()).status, 401);
  assert.equal((await put(BEA)).status, 403);
  assert.ok(h.audits.some(e => e.ev === 'trainer.media.denied' && e.uid === BEA && e.ok === false));
  await h.on(ANNA);
  const r = await put(ANNA);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.hash, r.body.size, r.body.existed, r.body.usage.count], [sha(video), video.length, false, 1]);
  assert.equal((await put(ANNA)).body.existed, true);
  const wrong = await h.call('PUT', `/api/media/trainer?hash=${'0'.repeat(64)}`, { uid: ANNA, upload: { bytes: video, mime: 'video/mp4' } });
  assert.deepEqual([wrong.status, wrong.body.code], [400, 'hash-mismatch']);
  assert.equal((await h.call('PUT', '/api/media/trainer', { uid: ANNA, upload: { bytes: video, mime: 'video/mp4' } })).status, 400);
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal((await h.call('PUT', `/api/media/trainer?hash=${sha(html)}`, { uid: ANNA, upload: { bytes: html, mime: 'image/jpeg' } })).status, 415);
  const ups = h.audits.filter(e => e.ev === 'trainer.media.upload');
  assert.equal(ups.length, 1, 'one new file, one entry');
  assert.equal(ups[0].msg, `${sha(video).slice(0, 12)} ${video.length} bytes`);
});

/* Demo media (demo-media.js) on upstream's own media store: what the sweep keeps, what it may
 * remove, the quota, and who may read a demo. In-process through the routes, with the clock
 * walked through the grace period instead of waited out. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, DAY } from './inproc.mjs';
import { trainerMediaLimits, libraryRefsState, DEFAULT_QUOTA_MB } from '../demo-media.js';
import { mediaLimits } from '../../media.js';
import { exerciseBody, jpeg, mp4, sha, videoRef } from './samples.mjs';

const ANNA = 'u_anna', BEA = 'u_bea';

test('limits: upstream\'s media settings, with the trainer quota from TRAINER_MEDIA_QUOTA_MB (500 MB by default)', () => {
  assert.equal(DEFAULT_QUOTA_MB, 500);
  assert.deepEqual(trainerMediaLimits({}), { ...mediaLimits({}), quotaMB: 500 });
  assert.equal(trainerMediaLimits({ TRAINER_MEDIA_QUOTA_MB: '0.5' }).quotaMB, 0.5);
  assert.equal(trainerMediaLimits({ TRAINER_MEDIA_QUOTA_MB: '0' }).quotaMB, 0, '0 = no cap, as upstream');
  for (const typo of ['lots', '-1', ' ']) assert.equal(trainerMediaLimits({ TRAINER_MEDIA_QUOTA_MB: typo }).quotaMB, 500, typo);
  // The per-file caps and the grace are the instance's own, and the instance quota is not this one.
  const l = trainerMediaLimits({ MEDIA_VIDEO_MAX_MB: '10', MEDIA_QUOTA_MB: '1', MEDIA_GC_GRACE_DAYS: '3' });
  assert.deepEqual([l.videoMB, l.quotaMB, l.gcGraceDays], [10, 500, 3]);
});

test('the pseudo-state the store reads: one custom exercise per library exercise with media, archived ones included', () => {
  const ref = videoRef(mp4(), jpeg());
  const doc = { exercises: [{ id: 'tx_1', media: ref, archived: true }, { id: 'tx_2' }, { id: 'tx_3', media: { ...ref, hash: 'b'.repeat(64) } }] };
  assert.deepEqual(libraryRefsState(doc), { customEx: [{ id: 'tx_1', media: ref }, { id: 'tx_3', media: { ...ref, hash: 'b'.repeat(64) } }] });
  assert.deepEqual(libraryRefsState(null), { customEx: [] });
});

/** Anna, switched on, with a demo video and its poster uploaded and an exercise that uses both. */
async function annaWithDemo(t, opts) {
  const h = harness(t, opts);
  await h.on(ANNA);
  const video = mp4(), poster = jpeg();
  for (const [bytes, mime] of [[video, 'video/mp4'], [poster, 'image/jpeg']]) {
    const r = await h.call('PUT', `/api/media/trainer?hash=${sha(bytes)}`, { uid: ANNA, upload: { bytes, mime } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const ref = videoRef(video, poster);
  const made = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody({ media: ref }) } });
  assert.equal(made.status, 201);
  const files = () => { try { return fs.readdirSync(path.join(h.dir, 'trainer', 'media', ANNA)).filter(n => !n.startsWith('.')).sort(); } catch { return []; } };
  return { h, video, poster, ref, id: made.body.exercise.id, rev: made.body.rev, files };
}

test('demo files live in DATA_DIR/trainer/media/<uid>/ with upstream\'s modes, never in DATA_DIR/uploads/', async t => {
  const a = await annaWithDemo(t);
  assert.deepEqual(a.files(), [`${sha(a.poster)}.jpg`, `${sha(a.video)}.mp4`].sort());
  assert.equal(fs.existsSync(path.join(a.h.dir, 'uploads')), false);
  const mode = p => fs.statSync(p).mode & 0o777;
  assert.equal(mode(path.join(a.h.dir, 'trainer', 'media', ANNA)), 0o700);
  assert.equal(mode(path.join(a.h.dir, 'trainer', 'media', ANNA, `${sha(a.video)}.mp4`)), 0o600);
});

test('the sweep keeps an archived exercise\'s demo for good, and lets go of a demo nothing uses after the grace', async t => {
  const a = await annaWithDemo(t);
  const del = await a.h.call('DELETE', `/api/trainer/library/exercises?id=${a.id}&baseRev=${a.rev}`, { uid: ANNA });
  assert.equal(del.status, 200);
  assert.equal(del.body.exercise.archived, true);
  // An upload no exercise ever named: the grace starts at the upload.
  const stray = jpeg(900);
  await a.h.call('PUT', `/api/media/trainer?hash=${sha(stray)}`, { uid: ANNA, upload: { bytes: stray, mime: 'image/jpeg' } });
  const sweepAll = () => a.h.internals.sweepDemos();
  a.h.clock.t += 13 * DAY;
  assert.equal(sweepAll().removed, 0, 'inside the grace nothing goes');
  a.h.clock.t += 2 * DAY;
  const r = sweepAll();
  assert.equal(r.removed, 1);
  assert.deepEqual(a.files(), [`${sha(a.poster)}.jpg`, `${sha(a.video)}.mp4`].sort(), 'the archived exercise\'s video and poster stay');
  a.h.clock.t += 365 * DAY;
  assert.equal(sweepAll().removed, 0);
  // …and the trainer can still fetch it.
  const got = await a.h.call('GET', `/api/media/trainer?hash=${sha(a.video)}`, { uid: ANNA });
  assert.equal(got.status, 200);
  assert.deepEqual(got.bytes, a.video);
});

test('a library file that is missing or cannot be read deletes nothing, however long it stays that way', async t => {
  const a = await annaWithDemo(t);
  const file = path.join(a.h.dir, 'trainer', 'library', `${ANNA}.json`);
  const sweepAll = () => a.h.internals.sweepDemos();
  for (const damage of [() => fs.writeFileSync(file, '{"v":1,'), () => fs.writeFileSync(file, '[]'), () => fs.rmSync(file)]) {
    damage();
    a.h.clock.t += 400 * DAY;
    const r = sweepAll();
    assert.equal(r.removed, 0);
    assert.equal(a.files().length, 2);
  }
  // A profile that is not in db.json is left alone too (upstream's orphan rule), even with a
  // readable library that no longer names the files.
  fs.writeFileSync(file, JSON.stringify({ v: 1, rev: 9, wid: null, exercises: [], programmes: [] }));
  a.h.uids.length = 0;
  a.h.clock.t += 400 * DAY;
  assert.equal(sweepAll().orphans, 1);
  assert.equal(a.files().length, 2);
});

test('a quota of its own: an upload past TRAINER_MEDIA_QUOTA_MB is refused with upstream\'s media-quota answer', async t => {
  const h = harness(t, { env: { TRAINER_MEDIA_QUOTA_MB: String(3000 / 1048576) } });
  await h.on(ANNA);
  const one = mp4({ bytes: 2000 }), two = mp4({ bytes: 2000 });
  assert.equal((await h.call('PUT', `/api/media/trainer?hash=${sha(one)}`, { uid: ANNA, upload: { bytes: one, mime: 'video/mp4' } })).status, 201);
  const over = await h.call('PUT', `/api/media/trainer?hash=${sha(two)}`, { uid: ANNA, upload: { bytes: two, mime: 'video/mp4' } });
  assert.equal(over.status, 413);
  assert.equal(over.body.code, 'media-quota');
  assert.ok(h.audits.some(e => e.ev === 'trainer.media.refused' && e.ok === false && /^media-quota/.test(e.msg)));
  // Uploads to the instance's own media (DATA_DIR/uploads) count against nothing here.
  assert.equal(fs.existsSync(path.join(h.dir, 'uploads')), false);
});

test('canReadDemo: in FIT-003 only the owning trainer, with trainer tools on; anyone else gets the 404 of a missing file', async t => {
  const a = await annaWithDemo(t);
  const hash = sha(a.video);
  const read = (uid, q = '') => a.h.call('GET', `/api/media/trainer?hash=${hash}${q}`, { uid });
  const missing = await read(ANNA, '').then(() => a.h.call('GET', `/api/media/trainer?hash=${'e'.repeat(64)}`, { uid: ANNA }));
  assert.equal(missing.status, 404);
  for (const [uid, q] of [[BEA, ''], [BEA, `&trainer=${ANNA}`]]) {
    const r = await read(uid, q);
    assert.equal(r.status, 404, `${uid} ${q}`);
    assert.deepEqual(r.body, missing.body, 'the same answer as a file that does not exist');
  }
  await a.h.on(BEA);
  assert.deepEqual((await read(BEA, `&trainer=${ANNA}`)).body, missing.body, 'trainer tools give Bea nothing of Anna\'s');
  assert.equal((await read(undefined)).status, 401);
  assert.equal((await a.h.call('GET', '/api/media/trainer?hash=xyz', { uid: ANNA })).status, 400);
  assert.ok(a.h.audits.some(e => e.ev === 'trainer.media.denied' && e.uid === BEA && e.ok === false));
  // Switched off, the owner's demos are not served either; switched back on, they are.
  await a.h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: false } });
  assert.equal((await read(ANNA)).status, 404);
  await a.h.on(ANNA);
  assert.equal((await read(ANNA)).status, 200);
});

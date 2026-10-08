/* Contract with upstream's api/media.js, as the trainer module's demo media relies on it
 * (demo-media.js, library.js). The module imports these and runs its own media store with them; a
 * rebase onto an upstream release that changed any of the behaviour below fails here, by name,
 * before an image is built. In-process, with the clock injected. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as media from '../../media.js';
import { createMediaStore, mediaLimits, referencedHashes, MediaError, HASH_RE, MEDIA_TYPES } from '../../media.js';
import { fakeUpload, jpeg, mp4, sha, videoRef } from './samples.mjs';

const DAY = 86400000;
const quiet = { log() {}, warn() {}, error() {} };

test('the exports the module imports exist, under these names', () => {
  for (const name of ['createMediaStore', 'mediaLimits', 'referencedHashes', 'MediaError', 'HASH_RE', 'MEDIA_TYPES']) {
    assert.ok(name in media, name);
  }
  assert.equal(HASH_RE.test('a'.repeat(64)), true);
  assert.equal(HASH_RE.test('A'.repeat(64)), false);
  assert.equal(HASH_RE.test('a'.repeat(63)), false);
});

test('MEDIA_TYPES: the seven stored types and their kinds (library.js validates MediaRefs against it)', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MEDIA_TYPES).map(([m, t]) => [m, t.kind])), {
    'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'gif',
    'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video'
  });
});

test('mediaLimits(env): the keys and defaults demo-media.js builds on', () => {
  const l = mediaLimits({});
  assert.deepEqual(Object.keys(l).sort(), ['enabled', 'gcGraceDays', 'gifMB', 'imageMB', 'minFreeMB', 'quotaMB', 'uploadsPerHour', 'videoMB', 'videoSec'].sort());
  assert.equal(l.enabled, true);
  assert.equal(l.gcGraceDays, 14);
  assert.equal(mediaLimits({ MEDIA_UPLOADS: '0' }).enabled, false);
  assert.equal(mediaLimits({ MEDIA_GC_GRACE_DAYS: '2' }).gcGraceDays, 2);
});

test('MediaError(status, code, extra): what the module throws and what server.js\'s catch-all answers', () => {
  const e = new MediaError(404, 'media-missing');
  assert.ok(e instanceof Error);
  assert.deepEqual([e.status, e.code, e.message], [404, 'media-missing', 'no such file']);
  assert.deepEqual(new MediaError(400, 'bad-request').extra, {});
});

test('referencedHashes(state): customEx[].media.hash and its poster hash, archived or not', () => {
  const ref = videoRef(mp4(), jpeg());
  const set = referencedHashes({ customEx: [{ id: 'tx_1', media: ref }, { id: 'tx_2' }, { id: 'tx_3', media: { hash: 'nope' } }] });
  assert.deepEqual([...set].sort(), [ref.hash, ref.poster.hash].sort());
  assert.equal(referencedHashes(null).size, 0);
});

function store(t, { limits = {}, readState = () => null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-media-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = { t: 1_800_000_000_000 };
  const dir = path.join(root, 'media');
  const s = createMediaStore({ dir, limits: { ...mediaLimits({}), minFreeMB: 0, ...limits }, now: () => clock.t, readState, idleMs: 5000, log: quiet });
  return { s, dir, clock };
}

test('createMediaStore({ dir, limits, now, readState, idleMs, log }): the store API the module calls', t => {
  const { s } = store(t);
  for (const fn of ['receive', 'file', 'has', 'usage', 'missing', 'noteState', 'sweep', 'sweepAll', 'discard', 'cleanTmp', 'removeUser']) {
    assert.equal(typeof s[fn], 'function', fn);
  }
  assert.equal(typeof s.limits, 'object');
});

test('receive(uid, hash, req): streams into <dir>/<uid>/<hash>.<ext> with 0700/0600 and answers { status, body }', async t => {
  const { s, dir } = store(t);
  const video = mp4();
  const r = await s.receive('u_anna', sha(video), fakeUpload(video, 'video/mp4'));
  assert.deepEqual(r, { status: 201, body: { ok: true, hash: sha(video), mime: 'video/mp4', size: video.length, existed: false } });
  const f = path.join(dir, 'u_anna', `${sha(video)}.mp4`);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(f)).mode & 0o777, 0o700);
  assert.deepEqual(s.file('u_anna', sha(video)), { path: f, ext: 'mp4', mime: 'video/mp4', size: video.length });
  assert.equal(s.has('u_anna', sha(video)), true);
  assert.equal(s.file('u_bea', sha(video)), null, 'the directory is the access check');
  assert.deepEqual(s.usage('u_anna'), { bytes: video.length, count: 1, quotaBytes: 200 * 1048576 });
  assert.equal((await s.receive('u_anna', sha(video), fakeUpload(video, 'video/mp4'))).body.existed, true);
});

test('receive refuses with MediaError: a bad hash, a mismatch, a type it does not store, the quota', async t => {
  const { s } = store(t, { limits: { quotaMB: 2500 / 1048576 } });
  const video = mp4({ bytes: 2000 });
  const fails = async (p, status, code) => {
    await assert.rejects(p, e => e instanceof MediaError && e.status === status && e.code === code, code);
  };
  await fails(s.receive('u', 'x', fakeUpload(video, 'video/mp4')), 400, 'bad-request');
  await fails(s.receive('u', '0'.repeat(64), fakeUpload(video, 'video/mp4')), 400, 'hash-mismatch');
  await fails(s.receive('u', sha(video), fakeUpload(video, 'text/html')), 415, 'media-type');
  await s.receive('u', sha(video), fakeUpload(video, 'video/mp4'));
  const two = mp4({ bytes: 2000 });
  await fails(s.receive('u', sha(two), fakeUpload(two, 'video/mp4')), 413, 'media-quota');
});

test('the sweep: keeps what readState references, removes the rest only after the grace, and nothing for a null state', async t => {
  let state = null;
  const { s, dir, clock } = store(t, { readState: () => state });
  const keep = jpeg(), drop = jpeg();
  for (const b of [keep, drop]) await s.receive('u_anna', sha(b), fakeUpload(b, 'image/jpeg'));
  const files = () => fs.readdirSync(path.join(dir, 'u_anna')).filter(n => !n.startsWith('.')).length;
  clock.t += 100 * DAY;
  assert.equal(s.sweep('u_anna').skipped, true, 'null state: skipped');
  assert.equal(files(), 2);
  state = { customEx: [{ id: 'tx_1', media: { hash: sha(keep) } }] };
  s.noteState('u_anna', state);
  assert.equal(s.sweep('u_anna').removed, 1, 'its grace started at the upload');
  assert.equal(s.has('u_anna', sha(keep)), true);
  // sweepAll: only the uids it is given; any other folder is an orphan and is left alone.
  assert.deepEqual(s.sweepAll({ uids: [] }), { swept: 0, removed: 0, freedBytes: 0, skipped: 0, orphans: 1, tmp: 0 });
  // A store that throws in readState is a null state too.
  const throwing = store(t, { readState: () => { throw new Error('boom'); } });
  await throwing.s.receive('u', sha(drop), fakeUpload(drop, 'image/jpeg'));
  throwing.clock.t += 100 * DAY;
  assert.equal(throwing.s.sweep('u').skipped, true);
});

test('removeUser(uid): the whole folder of one profile, and nothing else (the clean-up of a deleted trainer)', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-media-rm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createMediaStore({ dir, limits: { ...mediaLimits({}), minFreeMB: 0 }, log: quiet });
  for (const uid of ['u_a', 'u_b']) {
    fs.mkdirSync(path.join(dir, uid), { recursive: true });
    fs.writeFileSync(path.join(dir, uid, 'a'.repeat(64) + '.jpg'), 'x');
  }
  assert.equal(typeof store.removeUser, 'function');
  store.removeUser('u_a');
  assert.deepEqual(fs.readdirSync(dir), ['u_b']);
  assert.throws(() => store.removeUser(''), 'an id that sanitises to nothing names no folder');
  assert.deepEqual(fs.readdirSync(dir), ['u_b']);
});

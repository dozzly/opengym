/* Consent as data (links.js), assignments (assignments.js), the progress view (progress.js) and
 * the server's snapshot (snapshot.js), without HTTP. The routes are in link-routes.test.js, the
 * real server in server.test.js, and the snapshot's parity with the app's in
 * frontend/src/trainer/snapshot-parity.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  newInviteCode, normalizeCode, codeHash, inviteForCode, createLinkStore, createCodeLimiter, cleanStoredLinks,
  emptyLinks, LinkError, INVITE_TTL_MS, KEEP_CLOSED_MS, SCOPES, MODES
} from '../links.js';
import { createAssignmentStore, cleanStoredAssignment, assignedRoutineIds, KEEP_PUBLISHED } from '../assignments.js';
import { progressView, setView, PROGRESS_MAX } from '../progress.js';
import { snapshotProgramme, snapshotHashes } from '../snapshot.js';
import { resolveBuiltin } from '../library.js';
import { UNREADABLE } from '../store.js';

const DAY = 86400000;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-links-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const atomicWrite = (file, content) => { fs.writeFileSync(file + '.tmp', content); fs.renameSync(file + '.tmp', file); };

test('codes: PT- and 12 base32 characters from crypto; typed any way, one form; only the hash is kept', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = newInviteCode();
    assert.match(c, /^PT-[A-Z2-7]{12}$/);
    seen.add(c);
  }
  assert.equal(seen.size, 200);
  const c = 'PT-ABCDEFGH2345';
  for (const typed of [c, 'pt-abcdefgh2345', ' PT ABCD-EFGH-2345 ', 'ptabcdefgh2345']) assert.equal(normalizeCode(typed), c, typed);
  for (const bad of [null, 1, '', 'PT-ABCDEFGH234', 'PT-ABCDEFGH23456', 'XX-ABCDEFGH2345', 'PT-ABCDEFGH2341', 'PT-' + 'A'.repeat(80)]) assert.equal(normalizeCode(bad), null, String(bad));
  assert.match(codeHash(c), /^[0-9a-f]{64}$/);
  assert.notEqual(codeHash(c), codeHash('PT-ABCDEFGH2346'));
});

test('inviteForCode: unknown, used, revoked, expired and self are refused, with their codes; only code guesses count', () => {
  const t = 1_000_000;
  const doc = emptyLinks();
  const inv = (code, over) => ({ id: 'iv_' + '0'.repeat(16), trainer: 'u_anna', hash: codeHash(code), createdAt: t, expiresAt: t + INVITE_TTL_MS, ...over });
  doc.invites.push(inv('PT-AAAAAAAAAAAA'), inv('PT-BBBBBBBBBBBB', { usedAt: t }), inv('PT-CCCCCCCCCCCC', { revokedAt: t }), inv('PT-DDDDDDDDDDDD', { expiresAt: t }));
  const refusal = (code, who = 'u_cat') => { try { inviteForCode(doc, code, who, t); return null; } catch (e) { assert.ok(e instanceof LinkError); return [e.status, e.code, e.guess]; } };
  assert.equal(refusal('PT-AAAAAAAAAAAA'), null);
  assert.equal(inviteForCode(doc, 'pt aaaa aaaa aaaa', 'u_cat', t).trainer, 'u_anna');
  assert.deepEqual(refusal('nonsense'), [400, 'invite-invalid', true]);
  assert.deepEqual(refusal('PT-ZZZZZZZZZZZZ'), [404, 'invite-unknown', true]);
  assert.deepEqual(refusal('PT-BBBBBBBBBBBB'), [410, 'invite-used', true]);
  assert.deepEqual(refusal('PT-CCCCCCCCCCCC'), [410, 'invite-revoked', true]);
  assert.deepEqual(refusal('PT-DDDDDDDDDDDD'), [410, 'invite-expired', true]);
  assert.deepEqual(refusal('PT-AAAAAAAAAAAA', 'u_anna'), [400, 'self-link', false]);
});

test('the link store: empty when missing, a damaged file is never replaced, closed invites go after a month', t => {
  const dir = tmp(t);
  const clock = { t: 5 * DAY };
  const store = createLinkStore({ dir, atomicWrite, now: () => clock.t });
  assert.deepEqual(store.read(), emptyLinks());
  assert.equal(store.exists(), false);
  let out = store.change((doc, now) => { doc.invites.push({ id: 'iv_' + '1'.repeat(16), trainer: 'u_a', hash: 'a'.repeat(64), createdAt: now, expiresAt: now + INVITE_TTL_MS }); return {}; });
  assert.equal(out.status, 200);
  assert.equal(store.exists(), true);
  assert.equal(store.read().invites.length, 1);
  // Expired a week later; still on record for a month after that (so a late try reads "expired").
  clock.t += INVITE_TTL_MS + KEEP_CLOSED_MS - 1;
  store.change(() => ({}));
  assert.equal(store.read().invites.length, 1);
  clock.t += 2;
  store.change(() => ({}));
  assert.equal(store.read().invites.length, 0);
  // Unchanged writes nothing.
  const before = fs.statSync(store.file).mtimeMs;
  assert.equal(store.change(() => ({ unchanged: true })).status, 200);
  assert.equal(fs.statSync(store.file).mtimeMs, before);
  // A file that is not one: 503 for every write, and the file stays as it is.
  for (const junk of ['{"v":1,', '{"v":2,"invites":[],"links":[]}', '{"v":1,"invites":[{}],"links":[]}', 'null']) {
    fs.writeFileSync(store.file, junk);
    assert.equal(store.read(), UNREADABLE, junk);
    assert.equal(store.change(() => ({})).status, 503);
    assert.equal(fs.readFileSync(store.file, 'utf8'), junk);
  }
  assert.equal(cleanStoredLinks({ v: 1, invites: [], links: [{ id: 'lk_' + '1'.repeat(16), trainer: 'a', client: 'b', mode: 'self', scopes: [], shareBodyweight: false, createdAt: 1 }] }), UNREADABLE);
  assert.deepEqual(SCOPES, ['read_progress', 'write_assigned_plan']);
  assert.deepEqual(MODES, ['co-managed', 'trainer-managed']);
});

test('the code limiter: ten wrong codes an hour per user, then a wait; other users unaffected', () => {
  const clock = { t: 0 };
  const lim = createCodeLimiter({ now: () => clock.t });
  for (let i = 0; i < 10; i++) { assert.equal(lim.wait('u_a'), 0); lim.fail('u_a'); clock.t += 1000; }
  assert.ok(lim.wait('u_a') > 3000 && lim.wait('u_a') <= 3600);
  assert.equal(lim.wait('u_b'), 0);
  clock.t = 3600000;   // the first wrong code is an hour old
  assert.equal(lim.wait('u_a'), 0);
  clock.t = 2 * 3600000;
  assert.equal(lim.wait('u_a'), 0);
  assert.equal(lim.size(), 0);
});

test('the assignment store: baseRev 409s, the client\'s acknowledgement moves no revision, ten published kept', t => {
  const dir = tmp(t);
  const store = createAssignmentStore({ dir, atomicWrite });
  const L = 'lk_' + 'a'.repeat(16);
  assert.throws(() => store.read('../x'), /not a link id/);
  assert.deepEqual(store.read(L), { v: 1, rev: 0, wid: null, draft: null, published: [], applied: null });
  assert.equal(store.change(L, {}, () => ({})).status, 400);
  let out = store.change(L, { baseRev: 0 }, d => { d.draft = { programmeId: 'tp_' + '1'.repeat(16), note: '' }; return {}; });
  assert.deepEqual([out.status, out.doc.rev], [200, 1]);
  assert.equal(store.change(L, { baseRev: 0 }, () => ({})).status, 409);
  assert.equal(store.change(L, { baseRev: 1, baseWid: 'f'.repeat(16) }, () => ({})).status, 409, 'a write id from another history');
  const snap = { routines: [{ id: 'tr_' + '1'.repeat(16) }], customEx: [] };
  for (let i = 1; i <= 12; i++) {
    out = store.change(L, { baseRev: out.doc.rev, baseWid: out.doc.wid }, d => { d.published.push({ rev: i, at: i, snapshot: snap }); return {}; });
  }
  assert.equal(out.doc.published.length, KEEP_PUBLISHED);
  assert.deepEqual(out.doc.published.map(p => p.rev), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const rev = out.doc.rev;
  out = store.acknowledge(L, d => { d.applied = { rev: 12, at: 1, outcome: 'applied', routineIds: ['tr_' + '1'.repeat(16)] }; return {}; });
  assert.deepEqual([out.doc.rev, store.read(L).rev, store.read(L).applied.rev], [rev, rev, 12]);
  assert.deepEqual([...assignedRoutineIds(store.read(L))], ['tr_' + '1'.repeat(16)]);
  assert.deepEqual(store.ids(), [L]);
  fs.writeFileSync(store.file(L), '{"v":1,"rev":"x"}');
  assert.equal(store.read(L), UNREADABLE);
  assert.equal(store.acknowledge(L, () => ({})).status, 503);
  assert.equal(store.change(L, { baseRev: 0 }, () => ({})).status, 503);
  assert.equal(store.remove(L), true);
  assert.equal(store.remove(L), false);
  assert.equal(cleanStoredAssignment({ v: 1, rev: 0, draft: null, published: [{ rev: 1, snapshot: {} }], applied: null }), UNREADABLE);
});

/* ---------------------------------------------------------------- progress */

const R1 = 'tr_' + '0'.repeat(15) + '1', R2 = 'tr_' + '0'.repeat(15) + '2';
const TX = 'tx_' + '1'.repeat(16);
const assignment = {
  published: [{ rev: 1, snapshot: { routines: [{ id: R1, name: 'Lower' }], customEx: [{ id: TX, n: 'Split squat' }] } }],
  applied: { rev: 1, outcome: 'applied', routineIds: [R1] }
};
const media = { kind: 'image', hash: 'c'.repeat(64), mime: 'image/jpeg', size: 9, width: 1, height: 1 };
function clientState() {
  return {
    unit: 'kg', lang: 'de', theme: 'light', restSec: 120, reminder: { on: true }, coach: { consent: { agreedAt: 1 } },
    routines: [{ id: 'r_mine', name: 'My secret routine' }, { id: R1, name: 'Lower (renamed by me)' }],
    customEx: [{ id: 'c_mine', n: 'My own exercise', media }],
    bodyweight: [{ d: '2026-10-01', w: 61.2, t: 1 }, { d: '2027-01-20', w: 60.8, t: 2 }],
    workouts: [
      { id: 'w_old', d: '2027-01-01', start: Date.parse('2027-01-01T10:00:00Z'), end: Date.parse('2027-01-01T11:00:00Z'), routineIds: [R1], routineId: R1, entries: [{ id: TX, sets: [{ w: 20, r: 8, done: true }] }] },
      { id: 'w_mine', d: '2027-01-21', start: Date.parse('2027-01-21T10:00:00Z'), end: Date.parse('2027-01-21T11:00:00Z'), routineIds: ['r_mine'], routineId: 'r_mine', note: 'personal', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] },
      {
        id: 'w_1', d: '2027-01-22', start: Date.parse('2027-01-22T10:00:00Z'), end: Date.parse('2027-01-22T10:47:30Z'), name: 'Lower', bw: 61, vol: 900,
        routineIds: [R1], routineId: R1, note: 'Knee felt fine.', media: [media], prs: [TX],
        entries: [
          { id: TX, note: 'Went deeper', topW: 22.5, target: { w: 22.5 }, sets: [{ w: 20, r: 8, done: true, at: 5, rir: 2, phase: 'warmup' }, { w: 22.5, r: 8, done: true, rpe: 8.5 }, { w: 22.5, r: 6, done: false }] },
          { id: '0043', sets: [{ sides: { L: { w: 0, r: 10 }, R: { w: 0, r: 9 } }, done: true }, { sec: 45, done: true }, { min: 1.5, done: true }] },
          { id: 'c_mine', sets: [{ w: 5, r: 12, done: true }] }
        ]
      },
      {
        id: 'w_mixed', d: '2027-01-23', start: Date.parse('2027-01-23T10:00:00Z'), routineIds: [R1, 'r_mine'], routineId: R1, note: 'about my own part',
        entries: [{ id: TX, rid: R1, sets: [{ w: 25, r: 5, done: true }] }, { id: '0025', rid: 'r_mine', sets: [{ w: 70, r: 5, done: true }] }]
      },
      { id: 'w_other', d: '2027-01-24', start: Date.parse('2027-01-24T10:00:00Z'), routineIds: [R2], entries: [] }
    ]
  };
}
const SINCE = Date.parse('2027-01-15T00:00:00Z');

test('progress: only the link\'s routines, since the link began, newest first; sets as logged; no media, settings or own routines', () => {
  const view = progressView(clientState(), { assignment, since: SINCE });
  assert.equal(view.unit, 'kg');
  assert.deepEqual(view.workouts.map(w => w.id), ['w_mixed', 'w_1']);
  const w1 = view.workouts[1];
  assert.deepEqual(w1, {
    id: 'w_1', date: '2027-01-22', start: Date.parse('2027-01-22T10:00:00Z'), duration: 2850,
    routines: [{ id: R1, name: 'Lower' }],
    note: 'Knee felt fine.',
    exercises: [
      { id: TX, name: 'Split squat', note: 'Went deeper', sets: [
        { weight: 20, reps: 8, time: null, effort: { rir: 2 }, done: true, warmup: true },
        { weight: 22.5, reps: 8, time: null, effort: { rpe: 8.5 }, done: true },
        { weight: 22.5, reps: 6, time: null, effort: null, done: false }
      ] },
      { id: '0043', name: null, sets: [
        { weight: null, reps: null, time: null, effort: null, done: true, sides: { L: { weight: 0, reps: 10, time: null }, R: { weight: 0, reps: 9, time: null } } },
        { weight: null, reps: null, time: 45, effort: null, done: true },
        { weight: null, reps: null, time: 90, effort: null, done: true }
      ] },
      { id: 'c_mine', name: null, sets: [{ weight: 5, reps: 12, time: null, effort: null, done: true }] }
    ]
  });
  // A session that combined the delivered routine with one of the client's own: only the
  // delivered routine's entries, and no session note.
  assert.deepEqual(view.workouts[0].exercises.map(e => e.id), [TX]);
  assert.equal('note' in view.workouts[0], false);
  assert.deepEqual(view.workouts[0].routines, [{ id: R1, name: 'Lower' }]);
  const text = JSON.stringify(view);
  for (const secret of ['My secret routine', 'renamed by me', 'My own exercise', 'personal', 'about my own part', 'c'.repeat(64), '"lang"', 'theme', 'reminder', 'consent', 'bodyweight', 'prs', 'vol', 'topW', 'target']) {
    assert.ok(!text.includes(secret), secret);
  }
});

test('progress: a routine of that id that another trainer delivered (or the client made) is not this link\'s', () => {
  const S = clientState();
  S.routines = [{ id: R1, name: 'From an earlier trainer', assigned: { by: 'u_other', assignmentId: 'lk_old', rev: 3 } }];
  assert.deepEqual(progressView(S, { assignment, trainer: 'u_anna', since: SINCE }).workouts, []);
  S.routines = [{ id: R1, name: 'Delivered', assigned: { by: 'u_anna', assignmentId: 'lk_new', rev: 1 } }];
  assert.deepEqual(progressView(S, { assignment, trainer: 'u_anna', since: SINCE }).workouts.map(w => w.id), ['w_mixed', 'w_1']);
  // Deleted since (only the history names it): still the link's.
  S.routines = [];
  assert.deepEqual(progressView(S, { assignment, trainer: 'u_anna', since: SINCE }).workouts.map(w => w.id), ['w_mixed', 'w_1']);
});

test('progress: body weight only when the client shares it; nothing for a profile with no state; at most 100', () => {
  const shared = progressView(clientState(), { assignment, since: SINCE, shareBodyweight: true });
  assert.equal(shared.workouts[1].bodyweight, 61);
  assert.deepEqual(shared.bodyweight, [{ d: '2027-01-20', w: 60.8 }]);
  assert.deepEqual(progressView(null, { assignment }), { unit: 'kg', workouts: [] });
  const many = clientState();
  many.workouts = Array.from({ length: 150 }, (_, i) => ({ id: 'w' + i, d: '2027-02-01', start: SINCE + i * 1000, routineIds: [R1], entries: [] }));
  const v = progressView(many, { assignment, since: SINCE });
  assert.equal(v.workouts.length, PROGRESS_MAX);
  assert.equal(v.workouts[0].id, 'w149');
  assert.equal(setView(null), null);
  // Nothing delivered yet: nothing to read.
  assert.deepEqual(progressView(clientState(), { assignment: { published: [], applied: null }, since: 0 }).workouts, []);
});

/* ---------------------------------------------------------------- the server's snapshot */

test('snapshot: built-in slots keep their catalogue and must be in it; the trainer\'s exercises are full copies', () => {
  assert.deepEqual(resolveBuiltin({ id: '0043', catalog: 'og1' }), { id: '0043', catalog: 'og1' });
  for (const ref of [{ id: '9999', catalog: 'og1' }, { id: '0043', catalog: 'og2' }, { id: '0043' }, null, { id: 'x', catalog: 'og1' }]) assert.equal(resolveBuiltin(ref), null);
  const ex = { id: TX, rev: 3, n: 'Split squat', bp: 'upper legs', eq: '', desc: '', primaries: ['quadriceps'], secondaries: [], media: { ...media, poster: { hash: 'd'.repeat(64) } }, archived: true };
  const lib = {
    exercises: [ex],
    programmes: [{ id: 'tp_' + '1'.repeat(16), rev: 2, name: 'Block', unit: 'kg', week: {}, routines: [{ id: R1, name: 'Lower', ex: [{ id: TX, sets: 3 }, { id: '0043', catalog: 'og1', reps: 5 }, { id: '9999', catalog: 'og1' }] }] }]
  };
  const s = snapshotProgramme(lib, 'tp_' + '1'.repeat(16), { trainer: 'u_anna', assignmentId: 'lk_x', rev: 4 });
  assert.deepEqual(s.routines[0], { id: R1, name: 'Lower', assigned: { by: 'u_anna', assignmentId: 'lk_x', rev: 4 }, ex: [{ id: TX, sets: 3 }, { id: '0043', catalog: 'og1', reps: 5 }] });
  assert.deepEqual(s.unresolved, [{ routine: R1, index: 2, id: '9999', catalog: 'og1' }]);
  assert.deepEqual(s.customEx[0].src, { trainer: 'u_anna', exRev: 3 });
  assert.equal('archived' in s.customEx[0], false);
  assert.deepEqual([...snapshotHashes(s)], ['c'.repeat(64), 'd'.repeat(64)]);
  ex.n = 'Edited later';
  assert.equal(s.customEx[0].n, 'Split squat', 'a copy');
  assert.throws(() => snapshotProgramme(lib, 'tp_' + '9'.repeat(16), { trainer: 'u_anna' }), /no such programme/);
  assert.throws(() => snapshotProgramme(lib, 'tp_' + '1'.repeat(16)), /whose library/);
});

/* FIT-004's routes (link-routes.js) in-process, against the stand-ins in inproc.mjs, with the
 * clock injected: invites and the code limiter, accepting and its refusals, both sides' views,
 * ending a link, draft and publish with their conflicts, the client's acknowledgement, progress,
 * demo access for a linked client, the clean-up of deleted profiles, and the audit trail. The real
 * server is in server.test.js; the client's app against it in frontend/src/trainer/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, DAY } from './inproc.mjs';
import { exerciseBody, jpeg, mp4, programmeBody, sha, videoRef } from './samples.mjs';
import { INVITE_TTL_MS } from '../links.js';

const ANNA = 'u_anna', BEA = 'u_bea', CAT = 'u_cat', DAN = 'u_dan', OP = 'u_op';
const R1 = 'tr_0000000000000001';
const LK = id => 'lk_' + id.repeat(16).slice(0, 16);

/** Anna, switched on, with one exercise that has a demo video and poster, and a programme using it
 *  and a built-in exercise. */
async function setup(t, { env, uids = [ANNA, BEA, CAT, DAN, OP] } = {}) {
  const h = harness(t, { env, uids });
  await h.on(ANNA);
  const video = mp4(), poster = jpeg();
  for (const [bytes, mime] of [[video, 'video/mp4'], [poster, 'image/jpeg']]) {
    assert.equal((await h.call('PUT', `/api/media/trainer?hash=${sha(bytes)}`, { uid: ANNA, upload: { bytes, mime } })).status, 201);
  }
  let r = await h.call('POST', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: 0, exercise: exerciseBody({ media: videoRef(video, poster) }) } });
  const ex = r.body.exercise;
  r = await h.call('POST', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: r.body.rev, programme: programmeBody('Block 1', [{ id: ex.id, sets: 3, reps: 8 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 80 }]) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { h, ex, prog: r.body.programme, libRev: r.body.rev, video, poster };
}
async function invite(h, trainer = ANNA) {
  const r = await h.call('POST', '/api/trainer/invites', { uid: trainer });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.code;
}
async function link(h, client, mode = 'trainer-managed', { trainer = ANNA, shareBodyweight } = {}) {
  const code = await invite(h, trainer);
  const r = await h.call('POST', '/api/trainer/links/accept', { uid: client, body: { code, mode, ...(shareBodyweight != null ? { shareBodyweight } : {}) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.link;
}
async function publish(h, linkId, programmeId, { trainer = ANNA, note = '' } = {}) {
  let a = (await h.call('GET', `/api/trainer/assignments?link=${linkId}`, { uid: trainer })).body;
  let r = await h.call('PUT', '/api/trainer/assignments/draft', { uid: trainer, body: { link: linkId, programmeId, note, baseRev: a.rev } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: trainer, body: { link: linkId, baseRev: r.body.rev } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.published;
}

test('invites: a one-time code shown once, listed without it, at most ten open, revocable, gone after a week', async t => {
  const { h } = await setup(t);
  const r = await h.call('POST', '/api/trainer/invites', { uid: ANNA });
  assert.equal(r.status, 201);
  assert.match(r.body.code, /^PT-[A-Z2-7]{12}$/);
  assert.deepEqual(Object.keys(r.body.invite).sort(), ['createdAt', 'expiresAt', 'id']);
  assert.equal(r.body.invite.expiresAt - r.body.invite.createdAt, 7 * DAY);
  // Stored as a hash only.
  const raw = fs.readFileSync(path.join(h.dir, 'trainer', 'links.json'), 'utf8');
  assert.ok(!raw.includes(r.body.code) && !raw.includes(r.body.code.slice(3)));
  let list = (await h.call('GET', '/api/trainer/invites', { uid: ANNA })).body;
  assert.deepEqual(list.invites, [r.body.invite]);
  assert.ok(!JSON.stringify(list).includes(r.body.code.slice(3)) && !JSON.stringify(list).includes('hash'));
  for (let i = 0; i < 9; i++) await invite(h);
  const full = await h.call('POST', '/api/trainer/invites', { uid: ANNA });
  assert.deepEqual([full.status, full.body.code], [409, 'too-many-invites']);
  // Revoking one makes room; revoking it again, or someone else's, is a 404.
  assert.equal((await h.call('DELETE', `/api/trainer/invites?id=${r.body.invite.id}`, { uid: ANNA })).status, 200);
  assert.equal((await h.call('DELETE', `/api/trainer/invites?id=${r.body.invite.id}`, { uid: ANNA })).status, 404);
  await h.on(BEA);
  assert.equal((await h.call('DELETE', '/api/trainer/invites', { uid: BEA, body: { id: list.invites[0].id } })).status, 404);
  assert.equal((await h.call('POST', '/api/trainer/invites', { uid: ANNA })).status, 201);
  // A week later none is open, and all ten slots are free again.
  h.clock.t += INVITE_TTL_MS;
  list = (await h.call('GET', '/api/trainer/invites', { uid: ANNA })).body;
  assert.deepEqual(list.invites, []);
  // Trainer tools are needed for every invite route; none for anyone signed out.
  for (const [m, p] of [['POST', '/api/trainer/invites'], ['GET', '/api/trainer/invites'], ['DELETE', '/api/trainer/invites?id=x']]) {
    assert.equal((await h.call(m, p)).status, 401);
    const off = await h.call(m, p, { uid: CAT });
    assert.deepEqual([off.status, off.body.code], [403, 'trainer-off'], `${m} ${p}`);
  }
});

test('sign-in e-mails: shown beside the name on both sides; required on both sides while PASSWORD_LOGIN is on', async t => {
  const on = { TRAINER: '1', PASSWORD_LOGIN: '1' };
  // Without e-mails: the trainer cannot invite, and a client cannot accept (not counted as a wrong code).
  const bare = harness(t, { env: on, uids: [ANNA, CAT] });
  await bare.on(ANNA);
  let r = await bare.call('POST', '/api/trainer/invites', { uid: ANNA });
  assert.deepEqual([r.status, r.body.code, r.body.who], [409, 'email-required', 'trainer']);
  assert.ok(bare.audits.some(a => a.ev === 'trainer.invite.denied' && a.msg === 'email-required'));
  const withTrainer = harness(t, { env: on, uids: [ANNA, CAT], emails: { [ANNA]: 'anna@example.test' } });
  await withTrainer.on(ANNA);
  const code = (await withTrainer.call('POST', '/api/trainer/invites', { uid: ANNA })).body.code;
  for (let i = 0; i < 12; i++) {
    r = await withTrainer.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code, mode: 'co-managed' } });
    assert.deepEqual([r.status, r.body.code, r.body.who], [409, 'email-required', 'client']);
  }
  // Both with e-mails: the same code still works (no lock-out), and each side sees the other's address.
  const both = harness(t, { env: on, uids: [ANNA, CAT], emails: { [ANNA]: 'anna@example.test', [CAT]: 'cat@example.test' } });
  await both.on(ANNA);
  const code2 = (await both.call('POST', '/api/trainer/invites', { uid: ANNA })).body.code;
  r = await both.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: code2, mode: 'co-managed' } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.link.trainer, { id: ANNA, name: 'Name of ' + ANNA, email: 'anna@example.test' });
  const asTrainer = (await both.call('GET', '/api/trainer/links', { uid: ANNA })).body.asTrainer;
  assert.deepEqual(asTrainer[0].client, { id: CAT, name: 'Name of ' + CAT, email: 'cat@example.test' });
  const asClient = (await both.call('GET', '/api/trainer/links', { uid: CAT })).body.asClient;
  assert.equal(asClient.trainer.email, 'anna@example.test');
  // Without password sign-in there are no e-mails to require: links work, and show none.
  const off = harness(t, { env: { TRAINER: '1' }, uids: [ANNA, CAT] });
  await off.on(ANNA);
  const code3 = (await off.call('POST', '/api/trainer/invites', { uid: ANNA })).body.code;
  r = await off.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: code3, mode: 'co-managed' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.link.trainer.email, null);
});

test('accept: consumes the invite; used, revoked, expired, unknown, self and a second trainer are refused', async t => {
  const { h } = await setup(t);
  const code = await invite(h);
  assert.equal((await h.call('POST', '/api/trainer/links/accept', { body: { code, mode: 'co-managed' } })).status, 401);
  for (const body of [{ code }, { code, mode: 'admin' }, { code, mode: 'co-managed', shareBodyweight: 'yes' }]) {
    assert.equal((await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body })).status, 400, JSON.stringify(body));
  }
  // Self.
  let r = await h.call('POST', '/api/trainer/links/accept', { uid: ANNA, body: { code, mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [400, 'self-link']);
  // Accepted, as typed by a person.
  r = await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: code.toLowerCase().replace('-', ' '), mode: 'co-managed' } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.link, {
    id: r.body.link.id, trainer: { id: ANNA, name: 'Name of u_anna', email: null }, mode: 'co-managed', shareBodyweight: false,
    scopes: ['read_progress', 'write_assigned_plan'], createdAt: h.clock.t
  });
  assert.match(r.body.link.id, /^lk_[0-9a-f]{16}$/);
  // Used.
  r = await h.call('POST', '/api/trainer/links/accept', { uid: DAN, body: { code, mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [410, 'invite-used']);
  // Revoked.
  const revoked = await h.call('POST', '/api/trainer/invites', { uid: ANNA });
  await h.call('DELETE', `/api/trainer/invites?id=${revoked.body.invite.id}`, { uid: ANNA });
  r = await h.call('POST', '/api/trainer/links/accept', { uid: DAN, body: { code: revoked.body.code, mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [410, 'invite-revoked']);
  // Expired.
  const old = await invite(h);
  h.clock.t += INVITE_TTL_MS;
  r = await h.call('POST', '/api/trainer/links/accept', { uid: DAN, body: { code: old, mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [410, 'invite-expired']);
  // Unknown.
  r = await h.call('POST', '/api/trainer/links/accept', { uid: DAN, body: { code: 'PT-AAAAAAAAAAAA', mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [404, 'invite-unknown']);
  // A second trainer for a client who has one: 409, and Bea's invite stays usable.
  await h.on(BEA);
  const beas = await invite(h, BEA);
  r = await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: beas, mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [409, 'has-trainer']);
  assert.equal((await h.call('POST', '/api/trainer/links/accept', { uid: DAN, body: { code: beas, mode: 'co-managed' } })).status, 201);
  // A trainer who switched tools off since inviting cannot be linked.
  const late = await invite(h);
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: false } });
  r = await h.call('POST', '/api/trainer/links/accept', { uid: OP, body: { code: late, mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [410, 'trainer-unavailable']);
});

test('accept: one code, two people at once: exactly one link', async t => {
  const { h } = await setup(t);
  const code = await invite(h);
  const answers = await Promise.all([CAT, DAN, OP].map(uid => h.call('POST', '/api/trainer/links/accept', { uid, body: { code, mode: 'trainer-managed' } })));
  assert.deepEqual(answers.map(a => a.status).sort(), [201, 410, 410]);
  assert.equal(h.internals.links.read().links.length, 1);
});

test('the code limiter: ten wrong codes an hour, then 429 for any code, a good one included', async t => {
  const { h } = await setup(t);
  const good = await invite(h);
  for (let i = 0; i < 10; i++) {
    const r = await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: `PT-AAAAAAAAAA${'ABCDEFGHIJ'[i]}A`, mode: 'co-managed' } });
    assert.equal(r.status, 404);
  }
  const r = await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: good, mode: 'co-managed' } });
  assert.deepEqual([r.status, r.body.code], [429, 'locked']);
  assert.ok(r.body.retryAfter > 0);
  // Another user is not affected; an hour on, Cat may try again.
  assert.equal((await h.call('POST', '/api/trainer/links/accept', { uid: DAN, body: { code: 'PT-BBBBBBBBBBBB', mode: 'co-managed' } })).status, 404);
  h.clock.t += 3600000;
  assert.equal((await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: good, mode: 'co-managed' } })).status, 201);
});

test('links: each side\'s view; only the client changes mode and body weight; either side ends it at once', async t => {
  const { h, prog } = await setup(t);
  const cat = await link(h, CAT, 'co-managed');
  const dan = await link(h, DAN, 'trainer-managed', { shareBodyweight: true });
  await publish(h, cat.id, prog.id);
  let r = await h.call('GET', '/api/trainer/links', { uid: ANNA });
  assert.deepEqual(r.body.asClient, null);
  assert.deepEqual(r.body.asTrainer.map(l => [l.id, l.client.name, l.mode, l.shareBodyweight, l.published?.rev ?? null, l.applied]), [
    [cat.id, 'Name of u_cat', 'co-managed', false, 1, null],
    [dan.id, 'Name of u_dan', 'trainer-managed', true, null, null]
  ]);
  r = await h.call('GET', '/api/trainer/links', { uid: CAT });
  assert.deepEqual([r.body.asTrainer, r.body.asClient.id, r.body.asClient.trainer.name], [[], cat.id, 'Name of u_anna']);
  assert.deepEqual((await h.call('GET', '/api/trainer/links', { uid: OP })).body, { asTrainer: [], asClient: null });

  // The client switches mode and body weight; the trainer cannot, and nor can anyone else.
  r = await h.call('POST', '/api/trainer/links/update', { uid: CAT, body: { id: cat.id, mode: 'trainer-managed', shareBodyweight: true } });
  assert.deepEqual([r.status, r.body.link.mode, r.body.link.shareBodyweight], [200, 'trainer-managed', true]);
  for (const uid of [ANNA, DAN, OP]) assert.equal((await h.call('POST', '/api/trainer/links/update', { uid, body: { id: cat.id, mode: 'co-managed' } })).status, 404, uid);
  assert.equal((await h.call('POST', '/api/trainer/links/update', { uid: CAT, body: { id: cat.id } })).status, 400);
  assert.equal((await h.call('POST', '/api/trainer/links/update', { uid: CAT, body: { id: cat.id, mode: 'boss' } })).status, 400);

  // Ending: the client ends Cat's, the trainer ends Dan's; a stranger can end neither.
  assert.equal((await h.call('POST', '/api/trainer/links/revoke', { uid: OP, body: { id: cat.id } })).status, 404);
  assert.equal((await h.call('POST', '/api/trainer/links/revoke', { uid: CAT, body: { id: cat.id } })).status, 200);
  assert.equal((await h.call('POST', '/api/trainer/links/revoke', { uid: CAT, body: { id: cat.id } })).status, 404, 'ended already');
  assert.equal((await h.call('POST', '/api/trainer/links/revoke', { uid: ANNA, body: { id: dan.id } })).status, 200);
  assert.deepEqual((await h.call('GET', '/api/trainer/links', { uid: ANNA })).body.asTrainer, []);
  assert.equal((await h.call('GET', '/api/trainer/links', { uid: CAT })).body.asClient, null);
  // On record, with who ended it; its assignment is gone.
  const stored = h.internals.links.read().links.find(l => l.id === cat.id);
  assert.deepEqual([stored.revokedBy, typeof stored.revokedAt], [CAT, 'number']);
  assert.equal(fs.existsSync(path.join(h.dir, 'trainer', 'assignments', `${cat.id}.json`)), false);
  // A trainer who switched tools off can still end a link.
  const again = await link(h, CAT);
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: false } });
  assert.equal((await h.call('POST', '/api/trainer/links/revoke', { uid: ANNA, body: { id: again.id } })).status, 200);
});

test('draft and publish: stale writes 409, unknown or archived programmes and unresolved built-ins 400, a push without names', async t => {
  const { h, ex, prog, libRev } = await setup(t);
  const cat = await link(h, CAT, 'trainer-managed');
  let a = (await h.call('GET', `/api/trainer/assignments?link=${cat.id}`, { uid: ANNA })).body;
  assert.deepEqual([a.rev, a.draft, a.published, a.applied, a.preview], [0, null, [], null, null]);
  // Nothing to publish yet.
  let r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id, baseRev: 0 } });
  assert.deepEqual([r.status, r.body.code], [400, 'no-draft']);
  for (const programmeId of ['tp_' + 'f'.repeat(16), 'nope', undefined]) {
    r = await h.call('PUT', '/api/trainer/assignments/draft', { uid: ANNA, body: { link: cat.id, programmeId, baseRev: 0 } });
    assert.equal(r.status, 400, String(programmeId));
  }
  r = await h.call('PUT', '/api/trainer/assignments/draft', { uid: ANNA, body: { link: cat.id, programmeId: prog.id, note: 'Week one: easy.', baseRev: 0 } });
  assert.deepEqual([r.status, r.body.rev, r.body.draft], [200, 1, { programmeId: prog.id, note: 'Week one: easy.' }]);
  // Another tab still on revision 0.
  r = await h.call('PUT', '/api/trainer/assignments/draft', { uid: ANNA, body: { link: cat.id, programmeId: prog.id, note: 'Other tab', baseRev: 0 } });
  assert.deepEqual([r.status, r.body.rev, r.body.assignment.draft.note], [409, 1, 'Week one: easy.']);
  // The trainer's view previews what would be published.
  a = (await h.call('GET', `/api/trainer/assignments?link=${cat.id}`, { uid: ANNA })).body;
  assert.deepEqual([a.programme.id, a.programme.rev, a.libraryRev, a.preview.routines[0].assigned], [prog.id, 1, libRev, { by: ANNA, assignmentId: cat.id, rev: 1 }]);
  // Publishing against a library that changed since the preview, or a stale revision: refused.
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id, baseRev: 1, libraryRev: libRev - 1 } });
  assert.deepEqual([r.status, r.body.code], [409, 'library-changed']);
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id, baseRev: 0 } });
  assert.deepEqual([r.status, r.body.code], [409, 'conflict']);
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id } });
  assert.equal(r.status, 400, 'baseRev is required');
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id, baseRev: 1, libraryRev: libRev } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p1 = r.body.published;
  assert.deepEqual([p1.rev, p1.programmeId, p1.programmeRev, p1.note], [1, prog.id, 1, 'Week one: easy.']);
  assert.deepEqual(p1.snapshot.routines[0].ex, [{ id: ex.id, sets: 3, reps: 8 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 80 }]);
  assert.deepEqual(p1.snapshot.customEx.map(c => [c.id, c.src]), [[ex.id, { trainer: ANNA, exRev: 1 }]]);
  // The push: to the client, about nothing in particular.
  assert.deepEqual(h.pushes, [{ uid: CAT, title: 'Plan update from your trainer', body: 'Open openGym to load it.', tag: 'trainer-plan', url: '#/trainer' }]);
  // The server builds the snapshot: anything the trainer sends besides is ignored.
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id, baseRev: 2, snapshot: { routines: [{ id: 'evil' }] } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.published.snapshot.routines.map(x => x.id), [R1]);

  // A built-in id the catalogue does not have blocks publishing, and is listed.
  const lib = (await h.call('GET', '/api/trainer/library', { uid: ANNA })).body;
  r = await h.call('PUT', '/api/trainer/library/programmes', { uid: ANNA, body: { baseRev: lib.rev, id: prog.id, programme: programmeBody('Block 1', [{ id: ex.id, sets: 3 }, { id: '9999', catalog: 'og1' }, { id: '0043', catalog: 'og1' }, { id: '0001' }]) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id, baseRev: 3 } });
  assert.deepEqual([r.status, r.body.code, r.body.unresolved], [400, 'unresolved', [
    { routine: R1, index: 1, id: '9999', catalog: 'og1' }
  ]]);
  // An archived programme cannot be drafted or published.
  r = await h.call('DELETE', `/api/trainer/library/programmes?id=${prog.id}&baseRev=${lib.rev + 1}`, { uid: ANNA });
  assert.equal(r.status, 200);
  r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: cat.id, baseRev: 3 } });
  assert.deepEqual([r.status, r.body.code], [400, 'archived-programme']);
  r = await h.call('PUT', '/api/trainer/assignments/draft', { uid: ANNA, body: { link: cat.id, programmeId: prog.id, baseRev: 3 } });
  assert.deepEqual([r.status, r.body.code], [400, 'archived-programme']);
  // The draft can be cleared.
  r = await h.call('PUT', '/api/trainer/assignments/draft', { uid: ANNA, body: { link: cat.id, programmeId: null, baseRev: 3 } });
  assert.deepEqual([r.status, r.body.draft], [200, null]);
  assert.equal(h.pushes.length, 2);
});

test('publishing keeps the last ten revisions; a co-managed client is told to review', async t => {
  const { h, prog } = await setup(t);
  const cat = await link(h, CAT, 'co-managed');
  for (let i = 0; i < 12; i++) await publish(h, cat.id, prog.id);
  const a = (await h.call('GET', `/api/trainer/assignments?link=${cat.id}`, { uid: ANNA })).body;
  assert.deepEqual(a.published.map(p => p.rev), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(h.pushes.at(-1).body, 'Open openGym to review it.');
});

test('the client\'s side: the current revision, and acknowledgements that never widen what the trainer reads', async t => {
  const { h, prog } = await setup(t);
  assert.deepEqual((await h.call('GET', '/api/trainer/assignment', { uid: CAT })).body, { linked: false });
  assert.equal((await h.call('GET', '/api/trainer/assignment')).status, 401);
  const cat = await link(h, CAT, 'trainer-managed');
  let r = await h.call('GET', '/api/trainer/assignment', { uid: CAT });
  assert.deepEqual([r.body.linked, r.body.link.id, r.body.link.mode, r.body.published, r.body.applied], [true, cat.id, 'trainer-managed', null, null]);
  const p1 = await publish(h, cat.id, prog.id, { note: 'Go easy' });
  r = await h.call('GET', '/api/trainer/assignment', { uid: CAT });
  assert.deepEqual([r.body.published.rev, r.body.published.note, r.body.published.snapshot.routines[0].id], [1, 'Go easy', R1]);
  // The trainer cannot acknowledge for the client, nor can anyone else.
  for (const uid of [ANNA, DAN]) assert.equal((await h.call('POST', '/api/trainer/assignment/ack', { uid, body: { link: cat.id, rev: 1, outcome: 'applied', routineIds: [R1] } })).status, 404);
  for (const body of [
    { link: cat.id, rev: 0, outcome: 'applied', routineIds: [R1] },
    { link: cat.id, rev: 1, outcome: 'kept', routineIds: [R1] },
    { link: cat.id, rev: 1, outcome: 'applied', routineIds: ['r_mine'] },
    { link: cat.id, rev: 1, outcome: 'applied', routineIds: 'all' },
    { link: cat.id, rev: 1, outcome: 'applied', routineIds: ['tr_' + 'f'.repeat(16)] },
    { link: cat.id, rev: 2, outcome: 'applied', routineIds: [R1] }
  ]) {
    r = await h.call('POST', '/api/trainer/assignment/ack', { uid: CAT, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  r = await h.call('POST', '/api/trainer/assignment/ack', { uid: CAT, body: { link: cat.id, rev: 1, outcome: 'applied', routineIds: [R1] } });
  assert.deepEqual([r.status, r.body.applied.rev, r.body.applied.outcome, r.body.applied.routineIds], [200, 1, 'applied', [R1]]);
  // The acknowledgement moves no revision of the trainer's: her next write is not a conflict.
  const before = h.audits.length;
  assert.equal((await h.call('POST', '/api/trainer/assignment/ack', { uid: CAT, body: { link: cat.id, rev: 1, outcome: 'applied', routineIds: [R1] } })).status, 200);
  assert.equal(h.audits.length, before, 'the same acknowledgement again records nothing');
  await publish(h, cat.id, prog.id);
  // Undone on the device: the same revision, discarded, keeping only what the link delivered.
  r = await h.call('POST', '/api/trainer/assignment/ack', { uid: CAT, body: { link: cat.id, rev: 1, outcome: 'discarded', routineIds: [R1] } });
  assert.equal(r.status, 200);
  r = await h.call('POST', '/api/trainer/assignment/ack', { uid: CAT, body: { link: cat.id, rev: 2, outcome: 'discarded', routineIds: [R1] } });
  assert.deepEqual([r.status, r.body.applied.rev], [200, 2]);
  r = await h.call('POST', '/api/trainer/assignment/ack', { uid: CAT, body: { link: cat.id, rev: 1, outcome: 'applied', routineIds: [R1] } });
  assert.deepEqual([r.status, r.body.code], [409, 'stale']);
  assert.equal(p1.rev, 1);
});

test('progress: read-only and scoped to the link; another trainer\'s, an unknown or an ended link is a 404; the operator is never readable', async t => {
  const { h, prog } = await setup(t);
  const cat = await link(h, CAT, 'trainer-managed');
  // The operator, unlinked, has data of their own.
  h.writeState(OP, { unit: 'kg', routines: [{ id: R1, name: 'Same id, by chance' }], workouts: [{ id: 'w_op', d: '2027-02-01', start: h.clock.t + 1, routineIds: [R1], entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }] }] });
  const opFile = fs.readFileSync(h.stateFile(OP));
  await publish(h, cat.id, prog.id);
  const S = {
    unit: 'kg', routines: [{ id: 'r_mine', name: 'Mine' }],
    workouts: [
      { id: 'w_a', d: '2027-01-16', start: h.clock.t + 1000, end: h.clock.t + 1000 + 3600000, routineIds: [R1], note: 'Felt strong', entries: [{ id: '0043', sets: [{ w: 80, r: 5, done: true, rir: 2 }] }] },
      { id: 'w_b', d: '2027-01-16', start: h.clock.t + 2000, routineIds: ['r_mine'], entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }
    ]
  };
  h.writeState(CAT, S);
  const catFile = fs.readFileSync(h.stateFile(CAT));
  let r = await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid: ANNA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.workouts.map(w => w.id), ['w_a']);
  assert.deepEqual(r.body.workouts[0].exercises[0].sets, [{ weight: 80, reps: 5, time: null, effort: { rir: 2 }, done: true }]);
  assert.deepEqual(r.body.routines, [{ id: R1, name: 'Day 1' }]);
  assert.equal(r.body.workouts[0].note, 'Felt strong');
  assert.equal('bodyweight' in r.body, false);
  // Read, never written.
  assert.deepEqual(fs.readFileSync(h.stateFile(CAT)), catFile);

  // Nobody else reads it: the client, another trainer, a stranger, the trainer under another link id.
  await h.on(BEA);
  for (const uid of [CAT, BEA, OP, DAN]) {
    r = await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid });
    assert.ok([403, 404].includes(r.status), `${uid}: ${r.status}`);
  }
  // The operator: no link names them, so there is nothing to ask for — whatever is tried.
  for (const q of [OP, LK('0'), LK('f'), '', 'lk_../../state-u_op']) {
    r = await h.call('GET', `/api/trainer/progress?link=${q}`, { uid: ANNA });
    assert.deepEqual([r.status, r.body.code], [404, 'not-found'], q);
    r = await h.call('PUT', '/api/trainer/assignments/draft', { uid: ANNA, body: { link: q, programmeId: prog.id, baseRev: 0 } });
    assert.equal(r.status, 404, q);
    r = await h.call('POST', '/api/trainer/assignments/publish', { uid: ANNA, body: { link: q, baseRev: 0 } });
    assert.equal(r.status, 404, q);
  }
  assert.deepEqual(fs.readFileSync(h.stateFile(OP)), opFile);
  // Body weight only once the client shares it.
  h.writeState(CAT, { ...S, bodyweight: [{ d: '2027-01-16', w: 61.5 }], workouts: [{ ...S.workouts[0], bw: 61.5 }] });
  await h.call('POST', '/api/trainer/links/update', { uid: CAT, body: { id: cat.id, shareBodyweight: true } });
  r = await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid: ANNA });
  assert.deepEqual([r.body.bodyweight, r.body.workouts[0].bodyweight], [[{ d: '2027-01-16', w: 61.5 }], 61.5]);
  // A state file that does not parse: 503, and it is left as it is.
  fs.writeFileSync(h.stateFile(CAT), '{"routines":');
  assert.equal((await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid: ANNA })).status, 503);
  // Ended: a 404 at once.
  await h.call('POST', '/api/trainer/links/revoke', { uid: CAT, body: { id: cat.id } });
  r = await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid: ANNA });
  assert.equal(r.status, 404);
  // Turned off: 403 for every trainer route.
  await h.call('POST', '/api/trainer/capability', { uid: ANNA, body: { enabled: false } });
  assert.equal((await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid: ANNA })).status, 403);
});

test('demo files: a linked client reads what a published snapshot names, nothing else, and nothing once the link ends', async t => {
  const { h, ex, prog, video, poster } = await setup(t);
  const cat = await link(h, CAT, 'co-managed');
  const dan = await link(h, DAN, 'co-managed');
  const read = (uid, hash, trainer = ANNA) => h.call('GET', `/api/media/trainer?hash=${hash}&trainer=${trainer}`, { uid });
  // Linked, but nothing published yet: missing.
  assert.equal((await read(CAT, sha(video))).status, 404);
  await publish(h, cat.id, prog.id);
  let r = await read(CAT, sha(video));
  assert.equal(r.status, 200);
  assert.deepEqual(r.bytes, video);
  assert.equal((await read(CAT, sha(poster))).status, 200);
  // Dan has the same trainer but nothing published to him; the operator has no link at all.
  assert.equal((await read(DAN, sha(video))).status, 404);
  assert.equal((await read(OP, sha(video))).status, 404);
  // Another file of Anna's that no snapshot of Cat's link names.
  const other = jpeg(700);
  await h.call('PUT', `/api/media/trainer?hash=${sha(other)}`, { uid: ANNA, upload: { bytes: other, mime: 'image/jpeg' } });
  assert.equal((await read(CAT, sha(other))).status, 404);
  assert.equal((await read(ANNA, sha(other))).status, 200, 'the trainer reads her own');
  // Dan gets it once it is published to him: one exercise, one file, both clients.
  await publish(h, dan.id, prog.id);
  assert.equal((await read(DAN, sha(video))).status, 200);
  // The demo is replaced in the library: the published one is still served to the clients who have
  // not caught up, and the sweep keeps it for as long as a retained snapshot names it.
  const lib = (await h.call('GET', '/api/trainer/library', { uid: ANNA })).body;
  r = await h.call('PUT', '/api/trainer/library/exercises', { uid: ANNA, body: { baseRev: lib.rev, id: ex.id, exercise: exerciseBody({ media: { kind: 'image', hash: sha(other), mime: 'image/jpeg', size: other.length, width: 10, height: 10 } }) } });
  assert.equal(r.status, 200);
  h.clock.t += 30 * DAY;
  h.internals.sweepDemos();
  assert.equal(h.internals.demo.store.has(ANNA, sha(video)), true);
  assert.equal((await read(CAT, sha(video))).status, 200);
  // Ended: nothing, at once, though the file is still there for Dan.
  await h.call('POST', '/api/trainer/links/revoke', { uid: ANNA, body: { id: cat.id } });
  r = await read(CAT, sha(video));
  assert.deepEqual([r.status, r.body.code], [404, 'media-missing']);
  assert.equal((await read(DAN, sha(video))).status, 200);
  await h.call('POST', '/api/trainer/links/revoke', { uid: DAN, body: { id: dan.id } });
  assert.equal((await read(DAN, sha(video))).status, 404);
  // With no link naming it any more, the old demo goes after the grace period, as in FIT-003.
  h.internals.sweepDemos();
  h.clock.t += 15 * DAY;
  h.internals.sweepDemos();
  assert.equal(h.internals.demo.store.has(ANNA, sha(video)), false);
  assert.equal(h.internals.demo.store.has(ANNA, sha(other)), true);
  // Never a private upload: the module's routes cannot reach DATA_DIR/uploads/.
  assert.equal(fs.existsSync(path.join(h.dir, 'uploads')), false);
});

test('clean-up: the data of a deleted profile goes; a client keeps nothing of a deleted trainer\'s on the server; nothing with no users', async t => {
  const uids = [ANNA, BEA, CAT, DAN, OP];
  const { h, prog, video } = await setup(t, { uids });
  await h.on(BEA);
  const cat = await link(h, CAT, 'trainer-managed');
  const dan = await link(h, DAN, 'co-managed', { trainer: BEA });
  await publish(h, cat.id, prog.id);
  await invite(h);
  await invite(h, BEA);
  const t0 = path.join(h.dir, 'trainer');
  const files = () => {
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)).map(n => `${e.name}/${n}`) : [e.name]));
    return walk(t0).filter(n => !n.endsWith('.gc.json')).sort();
  };
  // An empty list of users never deletes anything.
  h.uids.length = 0;
  const before = files();
  assert.equal(h.internals.sweepGone().skipped, true);
  assert.deepEqual(files(), before);
  // Anna is deleted: her invites, her link to Cat and its assignment, her library, her demo
  // files and her switch. Bea's link to Dan stays.
  h.uids.push(BEA, CAT, DAN, OP);
  const r = h.internals.sweepGone();
  assert.deepEqual({ ...r, skipped: undefined }, { skipped: undefined, invites: 2, links: 1, assignments: 1, libraries: 1, media: 1, capabilities: 1 });
  assert.deepEqual(files(), ['capabilities.json', 'links.json']);
  const doc = h.internals.links.read();
  assert.deepEqual(doc.links.map(l => l.id), [dan.id]);
  assert.deepEqual(doc.invites.map(i => i.trainer), [BEA, BEA], 'the one Dan used, and an open one');
  assert.equal(h.internals.demo.store.has(ANNA, sha(video)), false);
  assert.equal((await h.call('GET', '/api/trainer/assignment', { uid: CAT })).body.linked, false);
  // Dan is deleted: his link goes, Bea keeps her (empty) library and switch.
  h.uids.splice(h.uids.indexOf(DAN), 1);
  assert.equal(h.internals.sweepGone().links, 1);
  assert.deepEqual(h.internals.links.read().links, []);
  assert.deepEqual(Object.keys(h.internals.capabilities.read().users), [BEA]);
  // Run again: nothing more.
  const again = h.internals.sweepGone();
  assert.deepEqual([again.links, again.invites, again.assignments, again.libraries, again.media, again.capabilities], [0, 0, 0, 0, 0, 0]);
  // An unreadable links.json: nothing that depends on it happens.
  fs.writeFileSync(path.join(t0, 'links.json'), 'garbage');
  h.uids.splice(h.uids.indexOf(BEA), 1);
  h.internals.sweepGone();
  assert.equal(fs.readFileSync(path.join(t0, 'links.json'), 'utf8'), 'garbage');
});

test('the audit trail: every FIT-004 event, with ids and counts only', async t => {
  const { h, prog } = await setup(t);
  h.audits.length = 0;
  const code = await invite(h);
  const inv2 = await h.call('POST', '/api/trainer/invites', { uid: ANNA });
  await h.call('DELETE', `/api/trainer/invites?id=${inv2.body.invite.id}`, { uid: ANNA });
  await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code: 'PT-AAAAAAAAAAAA', mode: 'co-managed' } });
  const cat = (await h.call('POST', '/api/trainer/links/accept', { uid: CAT, body: { code, mode: 'co-managed' } })).body.link;
  await h.call('POST', '/api/trainer/links/update', { uid: CAT, body: { id: cat.id, mode: 'trainer-managed' } });
  await publish(h, cat.id, prog.id, { note: 'A private note about her knee' });
  await h.call('POST', '/api/trainer/assignment/ack', { uid: CAT, body: { link: cat.id, rev: 1, outcome: 'applied', routineIds: [R1] } });
  await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid: ANNA });
  await h.call('GET', `/api/trainer/progress?link=${cat.id}`, { uid: OP });
  await h.call('POST', '/api/trainer/links/revoke', { uid: ANNA, body: { id: cat.id } });
  assert.deepEqual(h.audits.map(e => e.ev), [
    'trainer.invite.create', 'trainer.invite.create', 'trainer.invite.revoke',
    'trainer.link.denied', 'trainer.link.accept', 'trainer.link.update',
    'trainer.assignment.draft', 'trainer.assignment.publish', 'trainer.assignment.ack',
    'trainer.progress.read', 'trainer.progress.denied', 'trainer.link.revoke'
  ]);
  const text = JSON.stringify(h.audits);
  for (const secret of [code, code.slice(3), 'PT-AAAAAAAAAAAA', 'Name of', 'private note', 'knee', 'Block 1', 'Day 1', 'Split squat']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.ok(h.audits.every(e => e.uid && Object.keys(e).every(k => ['ev', 'uid', 'msg', 'ok'].includes(k))));
  assert.deepEqual(h.audits.filter(e => !e.ok).map(e => e.ev), ['trainer.link.denied', 'trainer.progress.denied']);
});

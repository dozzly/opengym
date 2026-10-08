/* The module's own files (store.js, capability.js): the conditional write, and the promise that a
 * missing or unreadable file reads as empty and is never replaced or deleted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLibraryStore, UNREADABLE, safeUid } from '../store.js';
import { createCapabilities, allowList } from '../capability.js';
import { emptyLibrary } from '../library.js';
import { atomicWrite } from '../../durable.js';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'trainer');
  const errors = [];
  return { root, dir, errors, lib: createLibraryStore({ dir, atomicWrite, log: { error: (...a) => errors.push(a.join(' ')) } }) };
}
const addOne = draft => { draft.programmes.push(); return { created: true }; };

test('a trainer without a library file has an empty one, and nothing is created by reading it', t => {
  const h = setup(t);
  assert.deepEqual(h.lib.read('u_anna'), emptyLibrary());
  assert.equal(h.lib.exists('u_anna'), false);
  assert.equal(fs.existsSync(h.dir), false);
});

test('every write names the revision it was based on: a stale one is a 409 with the current library', t => {
  const h = setup(t);
  assert.equal(h.lib.change('u_anna', {}, addOne).status, 400, 'no baseRev, no write');
  assert.equal(h.lib.change('u_anna', { baseRev: '0' }, addOne).status, 400);
  const first = h.lib.change('u_anna', { baseRev: 0 }, addOne);
  assert.equal(first.status, 201);
  assert.equal(first.doc.rev, 1);
  assert.match(first.doc.wid, /^[0-9a-f]{16}$/);
  const stale = h.lib.change('u_anna', { baseRev: 0 }, () => assert.fail('a stale write must not run'));
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.doc, first.doc);
  // The write id is checked too when it is given: a revision number alone can repeat after a restore.
  assert.equal(h.lib.change('u_anna', { baseRev: 1, baseWid: '0'.repeat(16) }, addOne).status, 409);
  assert.equal(h.lib.change('u_anna', { baseRev: 1, baseWid: first.doc.wid }, addOne).status, 201);
  assert.equal(h.lib.read('u_anna').rev, 2);
  // Nothing to change is no write and no new revision.
  assert.equal(h.lib.change('u_anna', { baseRev: 2 }, () => ({ unchanged: true })).status, 200);
  assert.equal(h.lib.read('u_anna').rev, 2);
  // A refusal thrown by the change leaves the file as it was.
  const before = fs.readFileSync(h.lib.file('u_anna'), 'utf8');
  assert.throws(() => h.lib.change('u_anna', { baseRev: 2 }, d => { d.exercises.push('x'); throw new Error('refused'); }));
  assert.equal(fs.readFileSync(h.lib.file('u_anna'), 'utf8'), before);
});

test('each trainer has a file of their own, named the way server.js names state files', t => {
  const h = setup(t);
  h.lib.change('u_anna', { baseRev: 0 }, addOne);
  h.lib.change('u_bea', { baseRev: 0 }, addOne);
  assert.deepEqual(fs.readdirSync(path.join(h.dir, 'library')).sort(), ['u_anna.json', 'u_bea.json']);
  assert.equal(safeUid('../u_anna'), 'u_anna');
  assert.throws(() => safeUid('../'), /profile id/);
  assert.equal(h.lib.file('../../db'), path.join(h.dir, 'library', 'db.json'), 'never outside the library directory');
});

test('a library file that cannot be read or is not a library: UNREADABLE, and never replaced', t => {
  const h = setup(t);
  h.lib.change('u_anna', { baseRev: 0 }, addOne);
  for (const junk of ['{"v":1,"rev":', '[]', 'null', '', '{"v":9,"rev":1,"exercises":[],"programmes":[]}', JSON.stringify({ ...emptyLibrary(), exercises: [{ id: 'nope' }] })]) {
    fs.writeFileSync(h.lib.file('u_anna'), junk);
    assert.equal(h.lib.read('u_anna'), UNREADABLE, junk);
    assert.equal(h.lib.exists('u_anna'), true);
    for (const baseRev of [0, 1]) {
      const out = h.lib.change('u_anna', { baseRev }, () => assert.fail('no write over an unreadable library'));
      assert.equal(out.status, 503);
    }
    assert.equal(fs.readFileSync(h.lib.file('u_anna'), 'utf8'), junk, 'left exactly as it was');
  }
  assert.ok(h.errors.length > 0, 'and said so in the log');
});

test('files get the modes upstream\'s state files get', t => {
  const h = setup(t);
  h.lib.change('u_anna', { baseRev: 0 }, addOne);
  const state = path.join(h.root, 'state-u_anna.json');
  atomicWrite(state, '{}');                       // what server.js does for a state file
  const mode = f => fs.statSync(f).mode & 0o777;
  assert.equal(mode(h.lib.file('u_anna')), mode(state));
  fs.mkdirSync(path.join(h.root, 'like-data'), { recursive: true });   // what server.js does for DATA_DIR
  assert.equal(mode(path.join(h.dir, 'library')), mode(path.join(h.root, 'like-data')));
});

/* ---------------------------------------------------------------- capability */

test('TRAINER_ALLOW: unset or empty lets anyone signed in switch on; set, only the ids it names', () => {
  assert.equal(allowList({}), null);
  assert.equal(allowList({ TRAINER_ALLOW: ' , ' }), null);
  assert.deepEqual([...allowList({ TRAINER_ALLOW: 'u_anna, u_bea,' })], ['u_anna', 'u_bea']);
});

test('switching on and off: self-service, recorded per user, and a removal from TRAINER_ALLOW counts as off', t => {
  const h = setup(t);
  const open = createCapabilities({ dir: h.dir, atomicWrite, env: {}, now: () => 5 });
  assert.equal(open.enabled('u_anna'), false);
  assert.equal(fs.existsSync(open.file), false, 'reading creates nothing');
  assert.deepEqual(open.set('u_anna', true), { status: 200, enabled: true });
  assert.equal(open.enabled('u_anna'), true);
  assert.equal(open.enabled('u_bea'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(open.file, 'utf8')), { v: 1, users: { u_anna: { enabled: true, at: 5 } } });
  assert.equal(open.set('u_anna', true).unchanged, true);

  const strict = createCapabilities({ dir: h.dir, atomicWrite, env: { TRAINER_ALLOW: 'u_bea' } });
  assert.equal(strict.enabled('u_anna'), false, 'on in the file, but no longer allowed');
  assert.deepEqual(strict.set('u_anna', true), { status: 403, code: 'not-allowed' });
  assert.equal(strict.set('u_anna', false).status, 200, 'switching off is always allowed');
  assert.equal(strict.set('u_bea', true).status, 200);
  assert.equal(strict.enabled('u_bea'), true);
});

test('an unreadable capabilities file: nobody is on, and it is never replaced', t => {
  const h = setup(t);
  const caps = createCapabilities({ dir: h.dir, atomicWrite, env: {} });
  caps.set('u_anna', true);
  for (const junk of ['{', '[]', '{"users":[]}', 'null']) {
    fs.writeFileSync(caps.file, junk);
    assert.equal(caps.enabled('u_anna'), false);
    assert.deepEqual(caps.set('u_bea', true), { status: 503, code: 'unreadable' });
    assert.deepEqual(caps.set('u_anna', false), { status: 503, code: 'unreadable' });
    assert.equal(fs.readFileSync(caps.file, 'utf8'), junk);
  }
});

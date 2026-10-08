/* The route factory against fakes: off unless TRAINER says on, and the status route's answers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainerRoutes, trainerEnabled, storeDir, MODULE_VERSION } from '../routes.js';

/** server.js's json() and readSession() in miniature: answers are collected, sessions are a header. */
function fakes() {
  const sent = [];
  const json = (res, code, obj) => sent.push({ code, obj });
  const readSession = req => (req.uid ? { id: req.uid, name: 'Someone' } : null);
  return { sent, helpers: { json, readSession } };
}

test('off unless TRAINER is set: no routes at all, so the server answers its plain 404', () => {
  const { helpers } = fakes();
  for (const TRAINER of [undefined, '', '0', 'false', 'off', 'no', 'trainer']) {
    assert.deepEqual(trainerRoutes(helpers, { TRAINER }), {}, `TRAINER=${TRAINER}`);
    assert.equal(trainerEnabled({ TRAINER }), false);
  }
  // Off, it does not even look at the helpers: an upstream change to them cannot stop a server
  // that does not run the module.
  assert.deepEqual(trainerRoutes(undefined, {}), {});
});

test('on with 1, true, yes or on, as upstream reads its own switches', () => {
  const { helpers } = fakes();
  for (const TRAINER of ['1', 'true', 'TRUE', 'yes', 'on']) {
    assert.deepEqual(Object.keys(trainerRoutes(helpers, { TRAINER })), ['GET /api/trainer/status'], `TRAINER=${TRAINER}`);
  }
});

test('every route is under /api/trainer/ and keyed the way server.js looks routes up', () => {
  const { helpers } = fakes();
  for (const key of Object.keys(trainerRoutes(helpers, { TRAINER: '1' }))) {
    assert.match(key, /^(GET|POST|PUT|DELETE) \/api\/trainer\/[a-z0-9/-]+$/);
  }
});

test('GET /api/trainer/status: 401 without a session, the module version with one', async () => {
  const { sent, helpers } = fakes();
  const route = trainerRoutes(helpers, { TRAINER: '1' })['GET /api/trainer/status'];
  await route({}, {});
  assert.deepEqual(sent.pop(), { code: 401, obj: { error: 'not signed in' } });
  await route({ uid: 'u1' }, {});
  assert.deepEqual(sent.pop(), { code: 200, obj: { enabled: true, module: MODULE_VERSION } });
  assert.match(MODULE_VERSION, /^\d+\.\d+\.\d+$/);
});

test('switched on, a helper server.js stopped passing stops the boot with its name', () => {
  assert.throws(() => trainerRoutes({ json() {} }, { TRAINER: '1' }), /no longer passes readSession/);
});

test('its own store is DATA_DIR/trainer, beside the files upstream owns', () => {
  assert.equal(storeDir('/data'), '/data/trainer');
});

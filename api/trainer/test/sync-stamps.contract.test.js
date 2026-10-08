/* Contract with upstream's api/sync-stamps.js (PUT /api/data's stamping), as the module's plan
 * delivery relies on it: a field the module puts on a routine or custom exercise (`assigned`) is
 * an ordinary entry field to the server. It is stored as sent, stamped per field like any other
 * when a writer that does not stamp changes it, and put back when such a writer leaves it out.
 * If upstream ever starts whitelisting entry fields, these fail before a client loses its plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../../sync-stamps.js';

const clone = v => JSON.parse(JSON.stringify(v));
const assigned = { by: 'u_trainer', assignmentId: 'as_1', rev: 3 };
const stored = () => ({
  _ts: 1000, _rev: 4,
  routines: [
    { id: 'r_mine', name: 'My own', _ts: 900, ex: [] },
    { id: 'r_as', name: 'Assigned A', _ts: 1000, assigned, ex: [{ id: '0001', sets: 3, reps: 8 }] }
  ],
  customEx: [{ id: 'c_t1', n: 'Trainer squat', bp: 'legs', custom: true, _ts: 1000, assigned: { ...assigned, exId: 'tx_1' } }]
});
const routine = (S, id = 'r_as') => S.routines.find(r => r.id === id);

test('the app (a stamping writer): the fields are stored exactly as sent', () => {
  const next = clone(stored());
  routine(next).assigned = { ...assigned, rev: 4 };
  stampPut(stored(), next, { overRead: true, stamped: true, now: 5000 });
  assert.deepEqual(routine(next).assigned, { ...assigned, rev: 4 });
  assert.deepEqual(next.customEx[0].assigned, { ...assigned, exId: 'tx_1' });
});

test('a writer that does not stamp, changing the field: kept, and stamped as that field\'s edit', () => {
  const next = clone(stored());
  routine(next).assigned = { ...assigned, rev: 4 };
  stampPut(stored(), next, { overRead: true, stamped: false, now: 5000 });
  assert.deepEqual(routine(next).assigned, { ...assigned, rev: 4 });
  assert.ok(routine(next)._f.assigned >= 5000, 'the change has a per-field stamp, so a merge keeps it');
  assert.equal(routine(next)._f.name, undefined, 'and only that field');
});

test('a writer that does not stamp and never knew the field: it is put back, not dropped', () => {
  const next = clone(stored());
  delete routine(next).assigned;
  delete next.customEx[0].assigned;
  routine(next).name = 'Renamed elsewhere';
  const report = {};
  stampPut(stored(), next, { overRead: true, stamped: false, now: 5000, report });
  assert.deepEqual(routine(next).assigned, assigned);
  assert.deepEqual(next.customEx[0].assigned, { ...assigned, exId: 'tx_1' });
  assert.equal(routine(next).name, 'Renamed elsewhere');
  assert.equal(report.changed, true, 'the server says it stored more than that writer sent');
});

test('the same without a base revision (a legacy overwrite) puts the field back too', () => {
  const next = clone(stored());
  delete routine(next).assigned;
  stampPut(stored(), next, { overRead: false, stamped: false, now: 5000 });
  assert.deepEqual(routine(next).assigned, assigned);
});

test('a writer that does not stamp removing an assigned routine: recorded as a removal like any other', () => {
  const next = clone(stored());
  next.routines = next.routines.filter(r => r.id !== 'r_as');
  stampPut(stored(), next, { overRead: true, stamped: false, now: 5000 });
  assert.equal(routine(next), undefined);
  assert.ok(next.deleted.routines.r_as >= 5000);
});

test('the app removing the field on purpose: the removal goes through', () => {
  const next = clone(stored());
  delete routine(next).assigned;
  stampPut(stored(), next, { overRead: true, stamped: true, now: 5000 });
  assert.equal('assigned' in routine(next), false);
});

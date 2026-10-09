/* The library's one gate (library.js): what an exercise and a programme may hold, how the
 * built-in references carry their catalogue, and the export's round trip. Pure, no I/O. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, EX_ID_RE, ROUTINE_ID_RE, LibraryError, newId, CURRENT_CATALOG, builtinRef,
  cleanMediaRef, cleanExerciseInput, exerciseRecord, sameExerciseContent,
  cleanProgrammeInput, programmeRecord, programmeExerciseIds,
  emptyLibrary, cleanStoredLibrary, exportLibrary, parseExport
} from '../library.js';
import { exerciseBody, jpeg, mp4, videoRef } from './samples.mjs';

const refusal = (code, field) => e => e instanceof LibraryError && e.code === code && (field === undefined || e.field === field);
const T = 1_800_000_000_000;
const ref = videoRef(mp4(), jpeg());

test('an exercise keeps upstream\'s custom-exercise fields, trimmed, and drops everything else', () => {
  const out = cleanExerciseInput({ ...exerciseBody({ n: '  Split squat ', url: 'https://example.com/v', media: ref }), id: 'c123', custom: true, _ts: 5, evil: '<script>' });
  assert.deepEqual(Object.keys(out), ['n', 'bp', 'eq', 'desc', 'primaries', 'secondaries', 'url', 'media']);
  assert.equal(out.n, 'Split squat');
  assert.deepEqual(out.media, ref);
  // A secondary that is also a primary is a primary.
  assert.deepEqual(cleanExerciseInput(exerciseBody({ primaries: ['chest'], secondaries: ['chest', 'triceps', 'triceps'] })).secondaries, ['triceps']);
});

test('an exercise is refused, not clamped, when a field is missing, too long or the wrong type', () => {
  for (const [over, field] of [
    [{ n: '' }, 'n'], [{ n: '   ' }, 'n'], [{ n: 'x'.repeat(LIMITS.name + 1) }, 'n'], [{ n: 'two\nlines' }, 'n'], [{ n: 7 }, 'n'],
    [{ bp: undefined }, 'bp'], [{ bp: 'x'.repeat(LIMITS.word + 1) }, 'bp'], [{ eq: ['barbell'] }, 'eq'],
    [{ desc: 'x'.repeat(LIMITS.desc + 1) }, 'desc'], [{ desc: 'bell\u0007' }, 'desc'],
    [{ primaries: 'quads' }, 'primaries'], [{ secondaries: Array(LIMITS.muscles + 1).fill('a') }, 'secondaries'],
    [{ url: 'javascript:alert(1)' }, 'url'], [{ url: 'https://user:pw@example.com' }, 'url'], [{ url: 'not a link' }, 'url'],
    [{ media: { ...ref, mime: 'image/svg+xml' } }, 'media'], [{ media: { ...ref, hash: 'abc' } }, 'media'], [{ media: 'x' }, 'media']
  ]) assert.throws(() => cleanExerciseInput(exerciseBody(over)), refusal('invalid', field), JSON.stringify(over).slice(0, 60));
  assert.throws(() => cleanExerciseInput(null), refusal('invalid', 'exercise'));
  // Instructions may run over several lines and be empty; the link may be left out.
  assert.equal(cleanExerciseInput(exerciseBody({ desc: '' })).desc, '');
  assert.equal('url' in cleanExerciseInput(exerciseBody({ url: '' })), false);
});

test('a MediaRef is rebuilt from its known fields: upstream\'s normalizeMediaRef on the server', () => {
  const out = cleanMediaRef({ ...ref, dur: 5.04, extra: 1, poster: { ...ref.poster, extra: 2 } });
  assert.equal(out.dur, 5);
  assert.equal('extra' in out || 'extra' in out.poster, false);
  // A bad poster is dropped on its own; the file still stands.
  assert.equal('poster' in cleanMediaRef({ ...ref, poster: { ...ref.poster, mime: 'image/png' } }), false);
  for (const bad of [{ kind: 'image' }, { codec: 'h266' }, { size: 0 }, { width: 20000 }, { dur: 4000 }, { mime: 'text/html' }]) {
    assert.equal(cleanMediaRef({ ...ref, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(cleanMediaRef({ ...ref, at: -1 }).at, 0);
});

test('a stored exercise: fixed field order, and only content counts as a change', () => {
  const content = cleanExerciseInput(exerciseBody({ media: ref }));
  const rec = exerciseRecord({ id: newId('tx'), rev: 1, archived: false, createdAt: T, updatedAt: T }, content);
  assert.match(rec.id, EX_ID_RE);
  assert.deepEqual(Object.keys(rec), ['id', 'rev', 'n', 'bp', 'eq', 'desc', 'primaries', 'secondaries', 'media', 'archived', 'createdAt', 'updatedAt']);
  assert.equal(sameExerciseContent(rec, content), true);
  assert.equal(sameExerciseContent({ ...rec, archived: true, updatedAt: T + 1 }, content), true);
  assert.equal(sameExerciseContent(rec, { ...content, desc: 'other' }), false);
});

/* ---------------------------------------------------------------- programmes */

const ex = (id, archived = false) => [id, { id, archived }];
const TX1 = 'tx_' + '1'.repeat(16), TX2 = 'tx_' + '2'.repeat(16), TXA = 'tx_' + 'a'.repeat(16);
const library = new Map([ex(TX1), ex(TX2), ex(TXA, true)]);
const routine = (over = {}) => ({ id: 'tr_' + '0'.repeat(15) + '1', name: 'Lower', emoji: 'dumbbell', ex: [{ id: TX1, sets: 3, reps: 8 }, { id: '0043', sets: 3, reps: 5, weight: 100 }], ...over });

test('a programme: upstream\'s routine shape, slots that name a library exercise or a built-in one with its catalogue', () => {
  const p = cleanProgrammeInput({
    name: ' Block 1 ', unit: 'lb', junk: 1,
    routines: [routine({ junk: 2, ex: [{ id: TX1, sets: 3, reps: 10, repsMin: 8, restSec: 90, note: 'slow down', sg: 'a1', side: true, trainerNote: 'dropped', _f: {} }, { id: '0043', mode: 'time', sec: 45 }] })],
    week: { 1: ['tr_' + '0'.repeat(15) + '1'], 3: 'tr_' + '0'.repeat(15) + '1' }
  }, { exercises: library });
  assert.deepEqual(p, {
    name: 'Block 1', unit: 'lb',
    routines: [{ id: 'tr_' + '0'.repeat(15) + '1', name: 'Lower', emoji: 'dumbbell', ex: [
      { id: TX1, sets: 3, reps: 10, repsMin: 8, restSec: 90, side: true, sg: 'a1', note: 'slow down' },
      { id: '0043', catalog: CURRENT_CATALOG, sec: 45, mode: 'time' }
    ] }],
    week: { 1: ['tr_' + '0'.repeat(15) + '1'], 3: ['tr_' + '0'.repeat(15) + '1'] }
  });
  assert.deepEqual([...programmeExerciseIds(p)], [TX1]);
});

test('every built-in reference goes through builtinRef, which knows the catalogue it came from', () => {
  assert.deepEqual(builtinRef('0043'), { id: '0043', catalog: 'og1' });
  assert.deepEqual(builtinRef('0043', 'og1'), { id: '0043', catalog: 'og1' });
  for (const [id, cat] of [['43', 'og1'], ['00431', 'og1'], [TX1, 'og1'], ['0043', 'og2'], ['0043', 'toString'], [43, 'og1']]) {
    assert.equal(builtinRef(id, cat), null, `${id} ${cat}`);
  }
  // A slot from an unknown catalogue is refused rather than read as today's.
  assert.throws(() => cleanProgrammeInput({ name: 'P', routines: [routine({ ex: [{ id: '0043', catalog: 'og2' }] })] }, { exercises: library }), refusal('invalid'));
  // One stored with its catalogue keeps it.
  const p = cleanProgrammeInput({ name: 'P', routines: [routine({ ex: [{ id: '9999', catalog: 'og1' }] })] }, { exercises: library });
  assert.deepEqual(p.routines[0].ex[0], { id: '9999', catalog: 'og1' }, 'an id the server cannot check is kept: the app shows it as unknown');
});

test('a programme names only library exercises that exist and are not archived, except ones it already used', () => {
  const body = ex => ({ name: 'P', routines: [routine({ ex })] });
  assert.throws(() => cleanProgrammeInput(body([{ id: 'tx_' + 'f'.repeat(16) }]), { exercises: library }), refusal('unknown-exercise'));
  assert.throws(() => cleanProgrammeInput(body([{ id: TXA }]), { exercises: library }), refusal('archived-exercise'));
  assert.equal(cleanProgrammeInput(body([{ id: TXA }]), { exercises: library, allowArchived: new Set([TXA]) }).routines[0].ex[0].id, TXA);
  assert.equal(cleanProgrammeInput(body([{ id: TXA }]), { exercises: library, allowArchived: true }).routines[0].ex[0].id, TXA);
  assert.throws(() => cleanProgrammeInput(body([{ id: 'c123' }]), { exercises: library }), refusal('invalid'), 'a personal custom exercise is no library exercise');
});

test('a cardio slot may carry a run planned in steps (FIT-009); run and instructions must fit in one note', () => {
  const run = { steps: [
    { kind: 'warmup', km: 2, target: { zone: 2 } },
    { kind: 'repeat', times: 5, work: { km: 1, target: { pace: 270 } }, rest: { sec: 90, how: 'jog' } },
    { kind: 'cooldown', km: 1 }
  ] };
  const one = slot => cleanProgrammeInput({ name: 'P', routines: [routine({ ex: [slot] })] }, { exercises: library });
  const p = one({ id: '0685', sets: 1, min: 40, note: 'Flat route', run: { ...run, junk: 1 } });
  assert.deepEqual(p.routines[0].ex[0], { id: '0685', catalog: 'og1', sets: 1, min: 40, note: 'Flat route', run });
  // It is stored as written and reads back the same.
  const doc = { ...emptyLibrary(), rev: 1, wid: 'ab'.repeat(8), programmes: [programmeRecord({ id: 'tp_' + '2'.repeat(16), rev: 1, archived: false, createdAt: 1, updatedAt: 1 }, p)] };
  assert.deepEqual(cleanStoredLibrary(JSON.parse(JSON.stringify(doc))).programmes[0].routines[0].ex[0].run, run);
  assert.throws(() => one({ id: '0685', run: { steps: [{ kind: 'easy', km: 1, target: { zone: 9 } }] } }), refusal('invalid', 'routines.0.ex.0.run.steps.0.target.zone'));
  assert.throws(() => one({ id: '0685', run: { steps: [] } }), refusal('invalid', 'routines.0.ex.0.run'));
  assert.throws(() => one({ id: '0685', note: 'x'.repeat(450), run }), refusal('too-long', 'routines.0.ex.0.run'));
});

test('a programme is refused on a bad slot value, a bad week or too many of anything', () => {
  const tryWith = over => () => cleanProgrammeInput({ name: 'P', routines: [routine()], ...over }, { exercises: library });
  const slot = s => ({ routines: [routine({ ex: [{ id: TX1, ...s }] })] });
  for (const s of [{ sets: 0 }, { sets: 21 }, { sets: 2.5 }, { reps: '8' }, { weight: -1 }, { weight: 5000 }, { mode: 'cardio' }, { side: 'yes' }, { sg: 'a b' }, { note: 'x'.repeat(LIMITS.note + 1) }, { reps: 8, repsMin: 8 }, { repsMin: 6 }]) {
    assert.throws(tryWith(slot(s)), refusal('invalid'), JSON.stringify(s));
  }
  assert.throws(tryWith({ name: '' }), refusal('invalid', 'name'));
  assert.throws(tryWith({ unit: 'stone' }), refusal('invalid', 'unit'));
  assert.throws(tryWith({ routines: 'x' }), refusal('invalid', 'routines'));
  assert.throws(tryWith({ routines: [routine({ name: '' })] }), refusal('invalid', 'routines.0.name'));
  assert.throws(tryWith({ routines: [routine({ emoji: '<b>' })] }), refusal('invalid', 'routines.0.emoji'));
  assert.throws(tryWith({ routines: Array(LIMITS.routines + 1).fill(0).map(() => routine({ id: undefined })) }), refusal('too-many', 'routines'));
  assert.throws(tryWith({ routines: [routine({ ex: Array(LIMITS.slots + 1).fill({ id: TX1 }) })] }), refusal('too-many', 'routines.0.ex'));
  assert.throws(tryWith({ week: { 7: [] } }), refusal('invalid', 'week'));
  assert.throws(tryWith({ week: { 1: ['tr_' + 'f'.repeat(16)] } }), refusal('invalid', 'week.1'));
  assert.throws(tryWith({ week: [] }), refusal('invalid', 'week'));
});

test('routine ids stay as given when well-formed and unique; others get a new id, and the week follows', () => {
  const p = cleanProgrammeInput({
    name: 'P',
    routines: [routine({ id: 'draft-a' }), routine({ id: 'tr_' + '0'.repeat(15) + '1' }), routine({ id: 'tr_' + '0'.repeat(15) + '1' })],
    week: { 2: ['draft-a', 'tr_' + '0'.repeat(15) + '1'] }
  }, { exercises: library });
  const [a, b, c] = p.routines.map(r => r.id);
  for (const id of [a, b, c]) assert.match(id, ROUTINE_ID_RE);
  assert.equal(b, 'tr_' + '0'.repeat(15) + '1');
  assert.notEqual(c, b, 'a repeated id is not kept twice');
  assert.deepEqual(p.week, { 2: [a, b] });
});

/* ---------------------------------------------------------------- the stored file and the export */

function sample() {
  const e1 = exerciseRecord({ id: TX1, rev: 3, archived: false, createdAt: T, updatedAt: T + 5 }, cleanExerciseInput(exerciseBody({ media: ref, url: 'https://example.com/' })));
  const e2 = exerciseRecord({ id: TXA, rev: 1, archived: true, createdAt: T, updatedAt: T }, cleanExerciseInput(exerciseBody({ n: 'Old one' })));
  const exercises = new Map([[TX1, e1], [TXA, e2]]);
  const p = programmeRecord({ id: 'tp_' + '1'.repeat(16), rev: 2, archived: false, createdAt: T, updatedAt: T },
    cleanProgrammeInput({ name: 'Block', routines: [routine({ ex: [{ id: TX1, sets: 3 }, { id: TXA }, { id: '0043' }] })], week: { 1: [routine().id] } }, { exercises, allowArchived: true }));
  return { ...emptyLibrary(), rev: 7, wid: 'ab'.repeat(8), exercises: [e1, e2], programmes: [p] };
}

test('a stored library reads back as written; anything else is refused, not repaired', () => {
  const doc = sample();
  assert.deepEqual(cleanStoredLibrary(JSON.parse(JSON.stringify(doc))), doc);
  for (const broken of [
    null, [], { ...doc, v: 2 }, { ...doc, rev: -1 }, { ...doc, wid: 'x' }, { ...doc, exercises: {} },
    { ...doc, exercises: [doc.exercises[0], doc.exercises[0]] },
    { ...doc, exercises: [{ ...doc.exercises[0], rev: 0 }] },
    { ...doc, programmes: [{ ...doc.programmes[0], routines: [routine({ id: 'not-stored-form' })] }] },
    { ...doc, exercises: [doc.exercises[0]] }             // a programme naming an exercise that is gone
  ]) assert.throws(() => cleanStoredLibrary(broken), LibraryError);
});

test('export: portable JSON with media refs and no bytes, no account id, and it round-trips', () => {
  const doc = sample();
  const out = exportLibrary(doc, { now: T, module: '0.2.0' });
  assert.deepEqual(Object.keys(out), ['opengym_trainer_library', 'module', 'exported', 'exercises', 'programmes']);
  assert.equal(out.exported, new Date(T).toISOString());
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /u_anna|owner/);
  assert.equal(out.exercises[0].media.hash, ref.hash, 'the ref travels; the file does not');
  assert.ok(text.length < 4000);
  // Round trip: through JSON and back through the same gates, nothing changes.
  assert.deepEqual(parseExport(text), { exercises: doc.exercises, programmes: doc.programmes });
  assert.deepEqual(parseExport(JSON.parse(text)), { exercises: doc.exercises, programmes: doc.programmes });
  assert.throws(() => parseExport('{'), LibraryError);
  assert.throws(() => parseExport({ ...out, opengym_trainer_library: 2 }), LibraryError);
  assert.throws(() => parseExport({ ...out, exercises: [{ ...out.exercises[0], n: '' }] }), LibraryError);
});

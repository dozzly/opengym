// @vitest-environment happy-dom
// The durable snapshot core (snapshot.js): what a published programme carries, that it survives
// later library edits and archiving, and that applying it changes the trainer's routines and
// exercises in a client's profile and nothing else, across revisions, with history attached.
import { beforeEach, describe, expect, it } from 'vitest'
import { snapshotProgramme, applySnapshot, deliverable, customExOf, SNAPSHOT_FORMAT } from './snapshot.js'
import { DEF, useStore, updateProfile, currentProfile, ASSIGNED, CATALOGUE } from './adapter.js'
import { mergeStates } from '../lib/sync-merge.js'
import { copyRoutine } from '../lib/routines.js'

const clone = v => JSON.parse(JSON.stringify(v))
const TRAINER = 'u_trainer'
const TX1 = 'tx_' + '1'.repeat(16), TX2 = 'tx_' + '2'.repeat(16), TX3 = 'tx_' + '3'.repeat(16)
const TP1 = 'tp_' + '1'.repeat(16)
const R1 = 'tr_' + '0'.repeat(15) + '1', R2 = 'tr_' + '0'.repeat(15) + '2', R3 = 'tr_' + '0'.repeat(15) + '3'
const media = {
  kind: 'video', hash: 'a'.repeat(64), mime: 'video/mp4', size: 4000, width: 640, height: 360, dur: 6, codec: 'avc1',
  poster: { hash: 'b'.repeat(64), mime: 'image/jpeg', size: 800, width: 480, height: 270 }, at: 1800000000000,
}

/** A library as GET /api/trainer/library answers it. */
function library() {
  const ex = (id, rev, over) => ({ id, rev, n: 'x', bp: 'upper legs', eq: 'dumbbell', desc: '', primaries: [], secondaries: [], archived: false, createdAt: 1, updatedAt: 1, ...over })
  return {
    v: 1, rev: 5, wid: 'ab'.repeat(8), owner: TRAINER,
    exercises: [
      ex(TX1, 1, { n: 'Split squat', desc: 'Front shin vertical.', primaries: ['quadriceps'], secondaries: ['gluteal'], media }),
      ex(TX2, 4, { n: 'Copenhagen plank', bp: 'waist', eq: 'body weight', primaries: ['adductors'] }),
      ex(TX3, 1, { n: 'Unused', bp: 'back' }),
    ],
    programmes: [{
      id: TP1, rev: 2, name: 'Block 1', unit: 'kg', archived: false, createdAt: 1, updatedAt: 1,
      routines: [
        { id: R1, name: 'Lower', emoji: 'dumbbell', ex: [{ id: TX1, sets: 3, reps: 8, weight: 20 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 100 }] },
        { id: R2, name: 'Core', ex: [{ id: TX2, sets: 3, sec: 30, mode: 'time' }] },
      ],
      week: { 1: [R1], 4: [R2] },
    }],
  }
}

/** A client's own profile: personal routines, a custom exercise, history, weigh-ins and settings. */
function client() {
  return {
    ...clone(DEF), unit: 'kg', restSec: 120, lang: 'en', theme: 'light', _ts: 1000,
    routines: [{ id: 'r_mine', name: 'My push day', emoji: 'dumbbell', _ts: 900, ex: [{ id: '0025', sets: 3, reps: 8, weight: 60 }] }],
    customEx: [{ id: 'c_mine', n: 'My band row', bp: 'back', eq: 'band', custom: true, _ts: 900 }],
    week: { 2: ['r_mine'] },
    bodyweight: [{ d: '2026-10-01', w: 61.2, t: 5 }],
    workouts: [{ id: 'w_old', d: '2026-10-02', routineIds: ['r_mine'], routineId: 'r_mine', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }],
    exWeights: { '0025': 60 },
  }
}
const without = (S, ...keys) => { const o = clone(S); for (const k of keys) delete o[k]; return o }
const routine = (S, id) => S.routines.find(r => r.id === id)

beforeEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null }) })

describe('snapshotProgramme', () => {
  it('upstream-shaped routines with the marker, and every library exercise they use as a full custom exercise under its tx_ id', () => {
    const snap = snapshotProgramme(library(), TP1)
    expect(snap).toMatchObject({ trainer_snapshot: SNAPSHOT_FORMAT, opengym_plan: 1, trainer: TRAINER, programme: { id: TP1, rev: 2 }, name: 'Block 1', unit: 'kg', week: { 1: [R1], 4: [R2] }, unresolved: [] })
    expect(snap.routines).toEqual([
      // A built-in slot keeps its catalogue: the device that applies it resolves it (FIT-004).
      { id: R1, name: 'Lower', emoji: 'dumbbell', [ASSIGNED]: { by: TRAINER, assignmentId: TP1, rev: 2 }, ex: [{ id: TX1, sets: 3, reps: 8, weight: 20 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 100 }] },
      { id: R2, name: 'Core', [ASSIGNED]: { by: TRAINER, assignmentId: TP1, rev: 2 }, ex: [{ id: TX2, sets: 3, sec: 30, mode: 'time' }] },
    ])
    expect(snap.customEx.map(c => c.id)).toEqual([TX1, TX2], 'only what the routines use')
    expect(snap.customEx[0]).toEqual({
      id: TX1, n: 'Split squat', bp: 'upper legs', eq: 'dumbbell', desc: 'Front shin vertical.', tg: 'quadriceps',
      primaries: ['quadriceps'], secondaries: ['gluteal'], sm: ['gluteal'], muscleGroups: ['quadriceps', 'gluteal'],
      media, custom: true, src: { trainer: TRAINER, exRev: 1 },
    })
    expect(snapshotProgramme(library(), TP1, { assignmentId: 'as_9', rev: 7 }).routines[0][ASSIGNED]).toEqual({ by: TRAINER, assignmentId: 'as_9', rev: 7 })
    expect(() => snapshotProgramme(library(), 'tp_' + '9'.repeat(16))).toThrow(/no such programme/)
    expect(() => snapshotProgramme({ ...library(), owner: undefined }, TP1)).toThrow()
  })

  it('is a copy: a later edit and then archiving the exercise change nothing in it (it keeps the old rev)', () => {
    const lib = library()
    const snap = snapshotProgramme(lib, TP1)
    const before = clone(snap)
    // The trainer edits the exercise (rev 2) and then archives it, in the library she holds.
    Object.assign(lib.exercises[0], { n: 'Split squat, elevated', desc: 'New cues', rev: 2 })
    lib.exercises[0].media.hash = 'c'.repeat(64)
    lib.exercises[0].archived = true
    lib.programmes[0].routines[0].ex[0].reps = 12
    expect(snap).toEqual(before)
    expect(snap.customEx[0].src.exRev).toBe(1)
    // The programme still snapshots with the archived exercise, at its new revision.
    const next = snapshotProgramme(lib, TP1)
    expect(next.customEx[0]).toMatchObject({ id: TX1, n: 'Split squat, elevated', src: { exRev: 2 } })
    expect('archived' in next.customEx[0]).toBe(false)
  })

  it('an unknown built-in id: no crash, the slot is listed as unresolved and left out of what is delivered', () => {
    const lib = library()
    lib.programmes[0].routines[0].ex.push({ id: '9999', catalog: 'og1', sets: 2 }, { id: '0043', catalog: 'og2' }, { id: 'tx_' + 'f'.repeat(16) })
    const snap = snapshotProgramme(lib, TP1)
    expect(snap.routines[0].ex.map(s => s.id)).toEqual([TX1, '0043'])
    expect(snap.unresolved).toEqual([
      { routine: R1, index: 2, id: '9999', catalog: 'og1' },
      { routine: R1, index: 3, id: '0043', catalog: 'og2' },
      { routine: R1, index: 4, id: 'tx_' + 'f'.repeat(16), catalog: null },
    ])
    // Under a catalogue that is not og1 any more, even a well-known id is not delivered as-is.
    const renumbered = CATALOGUE.slice(0, 900).map((e, i) => ({ ...e, id: String(i + 1).padStart(4, '0') }))
    expect(snapshotProgramme(library(), TP1, { catalogue: renumbered }).unresolved).toEqual([{ routine: R1, index: 1, id: '0043', catalog: 'og1' }])
  })
})

describe('applySnapshot', () => {
  it('adds the trainer\'s routines and exercises, and touches nothing else of the client\'s', () => {
    const S = client()
    const before = clone(S)
    const res = applySnapshot(S, snapshotProgramme(library(), TP1))
    expect(res).toEqual({ routineIds: [R1, R2], customExIds: [TX1, TX2], added: 2, replaced: 0, removed: [], dropped: 0 })
    expect(S.routines.map(r => r.id)).toEqual(['r_mine', R1, R2])
    expect(routine(S, R1)[ASSIGNED]).toEqual({ by: TRAINER, assignmentId: TP1, rev: 2 })
    expect(S.customEx.map(c => c.id)).toEqual(['c_mine', TX1, TX2])
    // Personal routines and custom exercises, workouts, weigh-ins, settings, the week: as they were.
    expect(routine(S, 'r_mine')).toEqual(routine(before, 'r_mine'))
    expect(S.customEx[0]).toEqual(before.customEx[0])
    expect(without(S, 'routines', 'customEx')).toEqual(without(before, 'routines', 'customEx'))
  })

  it('a new revision replaces only the recorded routines, in place and with their ids; history survives the re-apply', () => {
    const S = client()
    const first = applySnapshot(S, snapshotProgramme(library(), TP1))
    // The client trains the assigned routine, and the history names it and the trainer's exercise.
    const workout = { id: 'w_new', d: '2026-10-09', routineIds: [R1], routineId: R1, entries: [{ id: TX1, sets: [{ w: 20, r: 8, done: true }] }] }
    S.workouts.push(workout)
    S.exWeights[TX1] = 22.5
    S.week = { ...S.week, 1: [R1], 4: [R2] }
    const copy = copyRoutine(routine(S, R2))           // the client's own copy, marker and all
    S.routines.push(copy)

    // Revision 3: Lower edited, Core dropped, Upper added, and TX1 edited in the library (rev 2).
    const lib = library()
    lib.programmes[0].rev = 3
    lib.programmes[0].routines = [
      { id: R1, name: 'Lower body', emoji: 'dumbbell', ex: [{ id: TX1, sets: 4, reps: 6, weight: 24 }] },
      { id: R3, name: 'Upper', ex: [{ id: '0025', catalog: 'og1', sets: 3, reps: 10 }] },
    ]
    Object.assign(lib.exercises[0], { rev: 2, desc: 'Torso upright.' })
    const before = clone(S)
    const res = applySnapshot(S, snapshotProgramme(lib, TP1), { previousRoutineIds: first.routineIds })
    expect(res).toMatchObject({ routineIds: [R1, R3], added: 1, replaced: 1, removed: [R2] })
    // Replaced in place, same id, same position; the removed one is gone from the list and the week.
    expect(S.routines.map(r => r.id)).toEqual(['r_mine', R1, copy.id, R3])
    expect(routine(S, R1)).toMatchObject({ name: 'Lower body', ex: [{ id: TX1, sets: 4, reps: 6, weight: 24 }], [ASSIGNED]: { rev: 3 } })
    expect(S.week).toEqual({ 1: [R1], 2: ['r_mine'] })
    // History, progression, weigh-ins: untouched, and still pointing at things that exist.
    expect(S.workouts).toEqual(before.workouts)
    expect(S.exWeights).toEqual({ '0025': 60, [TX1]: 22.5 })
    expect(routine(S, R1)).toBeTruthy()
    // The exercise is upserted to the new revision; one the new revision no longer uses is kept.
    expect(S.customEx.find(c => c.id === TX1)).toMatchObject({ desc: 'Torso upright.', src: { trainer: TRAINER, exRev: 2 } })
    expect(S.customEx.find(c => c.id === TX2)).toMatchObject({ src: { exRev: 4 } })
    // The client's copy, which carries the marker, is not the module's: untouched.
    expect(routine(S, copy.id)).toEqual(copy)
    expect(without(S, 'routines', 'customEx', 'week')).toEqual(without(before, 'routines', 'customEx', 'week'))
  })

  it('applying an older snapshot after an edit delivers what that snapshot holds: snapshots are durable', () => {
    const lib = library()
    const old = snapshotProgramme(lib, TP1)
    Object.assign(lib.exercises[0], { rev: 2, n: 'Renamed' })
    lib.exercises[0].archived = true
    const S = client()
    applySnapshot(S, old)
    expect(S.customEx.find(c => c.id === TX1)).toMatchObject({ n: 'Split squat', src: { exRev: 1 }, media })
  })

  it('converts the trainer\'s units to the client\'s, through upstream\'s parsePlan', () => {
    const S = { ...client(), unit: 'lb' }
    applySnapshot(S, snapshotProgramme(library(), TP1))
    expect(routine(S, R1).ex[1].weight).toBe(220.5)
  })

  it('refuses, changing nothing, a routine or exercise id that is not the module\'s to overwrite', () => {
    const S = client()
    S.routines.push({ id: R1, name: 'Personal, by an accident of ids', ex: [] })
    const before = clone(S)
    expect(() => applySnapshot(S, snapshotProgramme(library(), TP1))).toThrow(expect.objectContaining({ code: 'id-collision' }))
    expect(S).toEqual(before)
    const T = client()
    T.customEx.push({ id: TX1, n: 'Someone else\'s', bp: 'back', custom: true, src: { trainer: 'u_other', exRev: 1 } })
    const tBefore = clone(T)
    expect(() => applySnapshot(T, snapshotProgramme(library(), TP1))).toThrow(expect.objectContaining({ code: 'id-collision' }))
    expect(T).toEqual(tBefore)
    expect(() => applySnapshot(client(), { routines: [] })).toThrow(expect.objectContaining({ code: 'not-snapshot' }))
  })

  it('through the store: stamped as the client\'s own change, kept by the sync merge, and a deleted routine delivered again stays', () => {
    useStore.setState({ S: client() })
    let res
    updateProfile(s => { res = applySnapshot(s, snapshotProgramme(library(), TP1)) })
    const S1 = clone(currentProfile())
    expect(routine(S1, R1)._ts).toBeGreaterThan(1000)
    expect(routine(S1, 'r_mine')._ts).toBe(900)
    // The client deletes the assigned Core routine; the trainer's next revision still has it.
    updateProfile(s => { s.routines = s.routines.filter(r => r.id !== R2) })
    expect(currentProfile().deleted.routines[R2]).toBeGreaterThan(0)
    const lib = library()
    lib.programmes[0].rev = 3
    updateProfile(s => { applySnapshot(s, snapshotProgramme(lib, TP1), { previousRoutineIds: res.routineIds }) })
    const S2 = currentProfile()
    expect(routine(S2, R2)._ts).toBeGreaterThan(S2.deleted.routines[R2])
    // A device still holding the copy from before the deletion, merged in either order: kept.
    for (const merged of [mergeStates(clone(S2), S1), mergeStates(S1, clone(S2))]) {
      expect(routine(merged, R2)?.[ASSIGNED]).toEqual({ by: TRAINER, assignmentId: TP1, rev: 3 })
      expect(routine(merged, 'r_mine')).toEqual(routine(S1, 'r_mine'))
    }
  })

  it('resolves each built-in slot in this app\'s catalogue, leaving out (and counting) one it cannot, never reading it as another', () => {
    const snap = snapshotProgramme(library(), TP1)
    const S = client()
    const res = applySnapshot(S, snap)
    expect(res.dropped).toBe(0)
    expect(routine(S, R1).ex[1]).toEqual({ id: '0043', sets: 3, reps: 5, weight: 100 })
    // The same snapshot on a device whose catalogue is no longer og1 (upstream v1.4.0 renumbers):
    // the slot is not delivered as whatever '0043' means there.
    const renumbered = CATALOGUE.map((e, i) => ({ ...e, id: String(i + 1).padStart(4, '0') }))
    const T = client()
    expect(applySnapshot(T, snap, { catalogue: renumbered }).dropped).toBe(1)
    expect(routine(T, R1).ex.map(x => x.id)).toEqual([TX1])
    // A catalogue this module does not know at all: the same.
    const odd = clone(snap)
    odd.routines[0].ex[1].catalog = 'og9'
    expect(deliverable(odd, 'kg').dropped).toBe(1)
    // A FIT-003 snapshot (no catalogue on its slots) still applies as it did.
    const legacy = clone(snap)
    delete legacy.routines[0].ex[1].catalog
    expect(deliverable(legacy, 'kg').routines[0].ex[1]).toEqual({ id: '0043', sets: 3, reps: 5, weight: 100 })
  })

  it('a slot\'s instructions (its note) reach the client\'s routine, where the workout screen shows them', () => {
    const lib = library()
    lib.programmes[0].routines[0].ex[1].note = '5 × 1 km at tempo, 90 s jog between'
    const S = client()
    applySnapshot(S, snapshotProgramme(lib, TP1))
    expect(routine(S, R1).ex[1]).toEqual({ id: '0043', sets: 3, reps: 5, weight: 100, note: '5 × 1 km at tempo, 90 s jog between' })
  })

  it('a climbing session reaches the client as text, every grade in both scales (FIT-010)', () => {
    const lib = library()
    lib.programmes[0].routines[0].ex[0] = { ...lib.programmes[0].routines[0].ex[0], note: 'Chalk up',
      climb: { scale: 'font', steps: [{ kind: 'circuit', rounds: 4, count: 4, grade: { from: '5+', to: '6A+' }, restSec: 240 }] } }
    const S = client()
    applySnapshot(S, snapshotProgramme(lib, TP1))
    const slot = routine(S, R1).ex[0]
    expect(slot.climb).toBeUndefined()
    expect(slot.note).toBe('1. 4 × 4 problems at Font 5+–6A+ (V2–V3), 4 min rest between rounds\n\nChalk up')
  })

  it('a run planned in steps reaches the client as text ahead of the instructions; the steps stay in the library (FIT-009)', () => {
    const lib = library()
    lib.programmes[0].routines[0].ex[1] = { id: '0685', catalog: 'og1', sets: 1, min: 40, note: 'Flat route',
      run: { steps: [{ kind: 'warmup', km: 2, target: { zone: 2 } }, { kind: 'repeat', times: 5, work: { km: 1, target: { pace: 270 } }, rest: { sec: 90, how: 'jog' } }] } }
    const S = client()
    applySnapshot(S, snapshotProgramme(lib, TP1))
    expect(routine(S, R1).ex[1]).toEqual({ id: '0685', sets: 1, min: 40,
      note: 'Total: 7 km + 7:30 min\n1. Warm-up 2 km in heart-rate zone 2\n2. 5 × 1 km at 4:30/km, 90 s jog between\n\nFlat route' })
  })

  it('a routine this trainer delivered before (same id, the trainer\'s marker) is replaced in place, on a new link or after an Undo', () => {
    const S = client()
    applySnapshot(S, snapshotProgramme(library(), TP1, { assignmentId: 'lk_old', rev: 3 }))
    S.workouts.push({ id: 'w_r1', d: '2026-10-09', routineIds: [R1], routineId: R1, entries: [] })
    // A new link to the same trainer: nothing recorded yet, and the same programme comes again.
    const res = applySnapshot(S, snapshotProgramme(library(), TP1, { assignmentId: 'lk_new', rev: 1 }), { previousRoutineIds: [] })
    expect(res).toMatchObject({ added: 0, replaced: 2 })
    expect(S.routines.filter(r => r.id === R1)).toHaveLength(1)
    expect(routine(S, R1)[ASSIGNED]).toEqual({ by: TRAINER, assignmentId: 'lk_new', rev: 1 })
    expect(S.workouts.at(-1).routineId).toBe(R1)
    // Another trainer's routine under that id is still not the module's to overwrite.
    const T = client()
    T.routines.push({ id: R1, name: 'Someone else\'s', [ASSIGNED]: { by: 'u_other', assignmentId: 'lk_x', rev: 1 }, ex: [] })
    expect(() => applySnapshot(T, snapshotProgramme(library(), TP1))).toThrow(expect.objectContaining({ code: 'id-collision' }))
  })

  it('customExOf: upstream\'s custom-exercise shape plus src, nothing of the library\'s bookkeeping', () => {
    const c = customExOf(library().exercises[1], TRAINER)
    expect(Object.keys(c).sort()).toEqual(['bp', 'custom', 'desc', 'eq', 'id', 'muscleGroups', 'n', 'primaries', 'secondaries', 'sm', 'src', 'tg'])
  })
})

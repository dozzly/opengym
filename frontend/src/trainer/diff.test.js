// @vitest-environment happy-dom
// The diff a trainer reads before publishing and a co-managed client before applying (diff.js).
import { describe, expect, it } from 'vitest'
import { diffPlans, heldPlan, slotChanges } from './diff.js'
import { diffLines } from './DiffList.jsx'
import { snapshotProgramme, deliverable } from './snapshot.js'
import { LINK_TEXT } from './strings.js'

const TX1 = 'tx_' + '1'.repeat(16), TX2 = 'tx_' + '2'.repeat(16)
const R1 = 'tr_' + '0'.repeat(15) + '1', R2 = 'tr_' + '0'.repeat(15) + '2', R3 = 'tr_' + '0'.repeat(15) + '3'
const ex = (id, rev, n) => ({ id, rev, n, bp: 'upper legs', eq: '', desc: '', primaries: [], secondaries: [], archived: false, createdAt: 1, updatedAt: 1 })
function library(over = {}) {
  return {
    owner: 'u_t', rev: 1,
    exercises: [ex(TX1, 1, 'Split squat'), ex(TX2, 1, 'Copenhagen plank')],
    programmes: [{
      id: 'tp_' + '1'.repeat(16), rev: 1, name: 'Block', unit: 'kg', archived: false, createdAt: 1, updatedAt: 1, week: {},
      routines: [
        { id: R1, name: 'Lower', emoji: 'dumbbell', ex: [{ id: TX1, sets: 3, reps: 8 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 100 }] },
        { id: R2, name: 'Core', ex: [{ id: TX2, sets: 3, sec: 30, mode: 'time' }] },
      ],
    }],
    ...over,
  }
}
const snap = lib => snapshotProgramme(lib, 'tp_' + '1'.repeat(16))

describe('diffPlans', () => {
  it('the first revision: everything is new', () => {
    const d = diffPlans(null, snap(library()))
    expect(d.routines.added.map(r => r.name)).toEqual(['Lower', 'Core'])
    expect(d.exercises.added.map(e => e.name)).toEqual(['Split squat', 'Copenhagen plank'])
    expect(d.empty).toBe(false)
  })

  it('the same programme again: no changes, whatever the marker says', () => {
    const a = snap(library())
    const b = snapshotProgramme(library(), 'tp_' + '1'.repeat(16), { assignmentId: 'lk_x', rev: 9 })
    expect(diffPlans(a, b)).toEqual({ routines: { added: [], removed: [], changed: [] }, exercises: { added: [], removed: [], revised: [] }, empty: true })
  })

  it('routines added, removed, renamed and changed; exercises added, removed, changed and reordered; exercise revisions', () => {
    const before = snap(library())
    const lib = library()
    lib.exercises[0].rev = 2
    lib.exercises.push(ex('tx_' + '3'.repeat(16), 1, 'Nordic curl'))
    lib.programmes[0].routines = [
      { id: R1, name: 'Lower body', emoji: 'legs', ex: [{ id: '0043', catalog: 'og1', sets: 5, reps: 5, weight: 100 }, { id: TX1, sets: 3, reps: 8 }, { id: 'tx_' + '3'.repeat(16), sets: 2, reps: 6 }] },
      { id: R3, name: 'Upper', ex: [{ id: '0025', catalog: 'og1', sets: 3, reps: 10 }] },
    ]
    const d = diffPlans(before, snap(lib))
    expect(d.routines.added).toEqual([{ id: R3, name: 'Upper' }])
    expect(d.routines.removed).toEqual([{ id: R2, name: 'Core' }])
    expect(d.routines.changed).toEqual([{ id: R1, name: 'Lower body', renamed: 'Lower', emoji: true, reordered: false, exercises: { added: ['tx_' + '3'.repeat(16)], removed: [], changed: ['0043'] } }])
    expect(d.exercises).toEqual({
      added: [{ id: 'tx_' + '3'.repeat(16), name: 'Nordic curl' }],
      removed: [{ id: TX2, name: 'Copenhagen plank' }],
      revised: [{ id: TX1, name: 'Split squat', from: 1, to: 2 }],
    })
    const names = { [TX1]: 'Split squat', '0043': 'barbell full squat', ['tx_' + '3'.repeat(16)]: 'Nordic curl' }
    expect(diffLines(d, id => names[id] || id, { showUnused: true })).toEqual([
      LINK_TEXT.newRoutine('Upper'),
      LINK_TEXT.removedRoutine('Core'),
      'Lower body: renamed from Lower; new icon; added Nordic curl; sets, reps or weight changed for barbell full squat',
      LINK_TEXT.newExercise('Nordic curl'),
      LINK_TEXT.revisedExercise('Split squat', 1, 2),
      LINK_TEXT.unusedExercise('Copenhagen plank'),
    ])
  })

  it('slots: only the order moved; one of two of the same exercise changed', () => {
    expect(slotChanges([{ id: 'a', sets: 1 }, { id: 'b', sets: 1 }], [{ id: 'b', sets: 1 }, { id: 'a', sets: 1 }])).toEqual({ added: [], removed: [], changed: [], reordered: true })
    expect(slotChanges([{ id: 'a', sets: 1 }, { id: 'a', sets: 2 }], [{ id: 'a', sets: 1 }, { id: 'a', sets: 3 }])).toEqual({ added: [], removed: [], changed: ['a'], reordered: false })
    expect(slotChanges([{ id: 'a', sets: 1, _f: 3 }], [{ id: 'a', sets: 1 }])).toEqual({ added: [], removed: [], changed: [], reordered: false })
    expect(slotChanges([{ id: 'a' }], [{ id: 'a' }, { id: 'a' }]).added).toEqual(['a'])
  })

  it('the client\'s side: what it holds against what Apply would write, in its own unit', () => {
    const s0 = snap(library())
    const plan = deliverable(s0, 'lb')
    const S = { unit: 'lb', routines: [{ id: 'r_mine', name: 'Mine', ex: [] }, ...plan.routines.map(r => ({ ...r, _ts: 5 }))], customEx: [{ id: 'c_mine', n: 'Mine', bp: 'back' }, ...plan.customEx] }
    // Nothing new: the same revision again shows no change, though the slot weights are in lb.
    expect(diffPlans(heldPlan(S, [R1, R2], 'u_t'), deliverable(s0, 'lb')).empty).toBe(true)
    expect(heldPlan(S, [R1], 'u_t').routines.map(r => r.id)).toEqual([R1])
    expect(heldPlan(S, [R1], 'u_t').customEx.map(c => c.id)).toEqual([TX1, TX2])
    // The client changed the weight of a delivered slot: Apply would set it back, so it shows.
    S.routines[1].ex[1].weight = 250
    expect(diffPlans(heldPlan(S, [R1, R2], 'u_t'), deliverable(s0, 'lb')).routines.changed[0].exercises.changed).toEqual(['0043'])
  })
})

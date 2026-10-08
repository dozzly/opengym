// @vitest-environment happy-dom
/* The trainer module's contract with upstream (dozzly/opengym, ADR 029).
 *
 * The module touches upstream only through adapter.js, and its plan delivery leans on upstream
 * behaviour it does not own: that a field it puts on a client's routine or custom exercise
 * (`assigned: { by, assignmentId, rev }`) lives through everything the client's app and the
 * server do to that data, and that the helpers it builds on keep doing what they do today. Each
 * of those is pinned here. A rebase onto an upstream release that changed one fails in this file,
 * by name, and the release is not built (.github/workflows/dozzly-sync.yaml).
 *
 * Findings this file encodes (summarised in dozzly/README.md, "Data contract"):
 *   (a) store load and heal: the routine and custom-exercise marker survives
 *   (b) the sync merge: it survives, and merges field by field like any other field
 *   (c) the server's PUT /api/data stamping: it survives, and is put back for a writer that
 *       never knew it
 *   (d) RoutineEdit: every routine-level edit keeps it; an exercise *slot*'s extra fields do not
 *       survive editing that exercise, and copyRoutine copies the marker onto the copy
 *   plus: mergePlan mints new ids and drops unknown routine fields, so it cannot apply an
 *   assignment revision; parsePlan keeps them.
 *
 * Written without JSX so the file keeps the name the README and the workflow give it. */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), setRemoteAuth: vi.fn() }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import * as adapter from './adapter.js'
import { ASSIGNED, DEF, useStore, parsePlan, pushSnapshot, revertLast, canRevert, SNAPSHOT_MAX, deleteRoutine } from './adapter.js'
import { restoredStateFor } from '../store/useStore.js'
import { healCustomEx } from '../lib/exercises.js'
import { convertStateUnit } from '../lib/units.js'
import { mergeStates, stampChange } from '../lib/sync-merge.js'
import { buildPlanBundle, mergePlan } from '../lib/plan-share.js'
import { copyRoutine } from '../lib/routines.js'
import { stampPut } from '../../../api/sync-stamps.js'
import RoutineEdit from '../views/RoutineEdit.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const h = React.createElement
const clone = v => JSON.parse(JSON.stringify(v))
const KEY = 'gym_state_v1'   // useStore.js: where the profile is kept on the device
const SQUAT = '0043', BENCH = '0025'

const mark = (rev = 1) => ({ by: 'u_trainer', assignmentId: 'as_1', rev })
const exMark = (rev = 1) => ({ ...mark(rev), exId: 'tx_squat' })
/** A client profile after an assignment was applied: one own routine, one delivered one. */
function profile(over = {}) {
  return {
    ...clone(DEF), _ts: 1000,
    routines: [
      { id: 'r_mine', name: 'My own', emoji: 'dumbbell', _ts: 900, ex: [{ id: BENCH, sets: 3, reps: 8, weight: 60 }] },
      { id: 'r_as', name: 'Assigned A', emoji: 'dumbbell', _ts: 1000, [ASSIGNED]: mark(), ex: [{ id: 'c_t1', sets: 3, reps: 5 }, { id: SQUAT, sets: 3, reps: 5, weight: 100 }] },
    ],
    customEx: [{ id: 'c_t1', n: 'Trainer split squat', bp: 'upper legs', eq: 'dumbbell', custom: true, _ts: 1000, [ASSIGNED]: exMark() }],
    week: { 1: ['r_as'], 4: ['r_mine'] },
    ...over,
  }
}
const routine = (S, id = 'r_as') => S.routines.find(r => r.id === id)

beforeEach(() => {
  localStorage.clear()
  Object.values(sheets).forEach(m => m.mockReset())
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

/* ------------------------------------------------------------------ the adapter's surface */

describe('the upstream surface the adapter hands the module', () => {
  it('exists, under the names the module calls', () => {
    for (const fn of ['useStore', 'api', 'parsePlan', 'pushSnapshot', 'revertLast', 'canRevert', 'deleteRoutine', 'Section', 'Row', 'useUser', 'currentProfile', 'updateProfile']) {
      expect(adapter[fn], fn).toBeTypeOf('function')
    }
    expect(ASSIGNED).toBe('assigned')
  })

  it('useStore: the profile is `S`, the account `user`, and `update(fn)` changes a draft of S', () => {
    const st = useStore.getState()
    expect(st).toHaveProperty('S')
    expect(st).toHaveProperty('user')
    expect(st.update).toBeTypeOf('function')
    useStore.setState({ S: profile() })
    adapter.updateProfile(s => { routine(s).name = 'Renamed' })
    expect(adapter.currentProfile()).toBe(useStore.getState().S)
    expect(routine(adapter.currentProfile()).name).toBe('Renamed')
  })

  it('DEF: routines and customEx are lists, week a map of weekday to routine ids', () => {
    expect(DEF.routines).toEqual([])
    expect(DEF.customEx).toEqual([])
    expect(DEF.week).toEqual({})
    // A weekday holds a list of routine ids (several routines a day), not one id.
    const S = profile()
    expect(Array.isArray(S.week[1])).toBe(true)
  })
})

/* ------------------------------------------------------- (a) store load and heal paths */

describe('(a) the marker survives the store loading and healing a profile', () => {
  it('update(): kept on the routine, and its own change is stamped per field for the merge', () => {
    useStore.setState({ S: profile() })
    useStore.getState().update(s => { routine(s).name = 'Renamed' })
    let r = routine(useStore.getState().S)
    expect(r[ASSIGNED]).toEqual(mark())
    expect(r._f?.name).toBeGreaterThan(1000)
    expect(r._f?.[ASSIGNED]).toBeUndefined()
    useStore.getState().update(s => { routine(s)[ASSIGNED] = mark(2) })
    r = routine(useStore.getState().S)
    expect(r[ASSIGNED]).toEqual(mark(2))
    expect(r._f[ASSIGNED]).toBeGreaterThan(1000)
    // …and saved on the device with it.
    expect(routine(JSON.parse(localStorage.getItem(KEY)))[ASSIGNED]).toEqual(mark(2))
  })

  it('a fresh start of the app reads it back from the device, custom exercises healed with it', async () => {
    const saved = profile()
    delete saved.customEx[0].custom   // as an older plan import stored it: the heal puts the flag back
    localStorage.setItem(KEY, JSON.stringify(saved))
    vi.resetModules()
    const fresh = await import('../store/useStore.js')
    const S = fresh.useStore.getState().S
    expect(routine(S)[ASSIGNED]).toEqual(mark())
    expect(S.customEx[0].custom).toBe(true)
    expect(S.customEx[0][ASSIGNED]).toEqual(exMark())
  })

  it('healCustomEx, restoredStateFor and a unit switch keep it', () => {
    const healed = healCustomEx([{ id: 'c_t1', n: 'x', bp: 'back', [ASSIGNED]: exMark() }])
    expect(healed[0]).toMatchObject({ custom: true, [ASSIGNED]: exMark() })

    const restored = restoredStateFor(clone(DEF), profile())
    expect(routine(restored)[ASSIGNED]).toEqual(mark())
    expect(restored.customEx[0][ASSIGNED]).toEqual(exMark())

    const lb = convertStateUnit(profile(), 'lb')
    expect(routine(lb)[ASSIGNED]).toEqual(mark())
    expect(routine(lb).ex[1].weight).not.toBe(100)   // the numbers move, the marker does not
  })

  it('a backup imported over the profile keeps it', () => {
    useStore.getState().importBackup(profile())
    const S = useStore.getState().S
    expect(routine(S)[ASSIGNED]).toEqual(mark())
    expect(S.customEx[0][ASSIGNED]).toEqual(exMark())
  })
})

/* --------------------------------------------------------------------- (b) sync merge */

describe('(b) the marker survives the sync merge, field by field', () => {
  // Two devices start from the same copy; each changes it through the store's own stamping.
  function twoDevices(onA, onB) {
    const base = profile()
    const a = clone(base), b = clone(base)
    onA(a); a._ts = stampChange(base, a, 5000)
    onB(b); b._ts = stampChange(base, b, 6000)
    return { a, b }
  }

  it('a rename on one device and a new revision on the other: both kept', () => {
    const { a, b } = twoDevices(s => { routine(s).name = 'Renamed on the phone' }, s => { routine(s)[ASSIGNED] = mark(2) })
    for (const merged of [mergeStates(a, b), mergeStates(b, a)]) {
      expect(routine(merged).name).toBe('Renamed on the phone')
      expect(routine(merged)[ASSIGNED]).toEqual(mark(2))
    }
  })

  it('a routine or custom exercise only one copy has keeps its marker', () => {
    const base = profile()
    const without = { ...clone(base), routines: [routine(base, 'r_mine')], customEx: [], _ts: 1 }
    const merged = mergeStates(base, without)
    expect(routine(merged)[ASSIGNED]).toEqual(mark())
    expect(merged.customEx[0][ASSIGNED]).toEqual(exMark())
  })

  it('a custom exercise renamed here and updated by a new revision there: both kept', () => {
    const { a, b } = twoDevices(s => { s.customEx[0].n = 'My name for it' }, s => { s.customEx[0][ASSIGNED] = exMark(2) })
    const merged = mergeStates(a, b)
    expect(merged.customEx[0].n).toBe('My name for it')
    expect(merged.customEx[0][ASSIGNED]).toEqual(exMark(2))
  })

  it('sign-in (prefer) keeps it too; a removal on record removes the routine like any other', () => {
    expect(routine(mergeStates(profile(), clone(DEF), { prefer: 'a' }))[ASSIGNED]).toEqual(mark())
    const { a, b } = twoDevices(s => { deleteRoutine(s, 'r_as') }, () => {})
    expect(routine(mergeStates(a, b))).toBeUndefined()
  })
})

/* ------------------------------------------------- (c) the server's PUT /api/data stamping */

describe('(c) the marker survives the server\'s stamping (api/sync-stamps.js stampPut)', () => {
  it('the app (stamped): stored as sent', () => {
    const next = profile()
    routine(next)[ASSIGNED] = mark(2)
    stampPut(profile(), next, { overRead: true, stamped: true, now: 9000 })
    expect(routine(next)[ASSIGNED]).toEqual(mark(2))
  })

  it('an older app or API client that leaves it out: put back from the stored copy', () => {
    const next = profile()
    delete routine(next)[ASSIGNED]
    delete next.customEx[0][ASSIGNED]
    stampPut(profile(), next, { overRead: true, stamped: false, now: 9000 })
    expect(routine(next)[ASSIGNED]).toEqual(mark())
    expect(next.customEx[0][ASSIGNED]).toEqual(exMark())
  })
})

/* -------------------------------------------------------------------- (d) RoutineEdit */

describe('(d) editing an assigned routine in RoutineEdit', () => {
  let root, host
  function mount(S) {
    useStore.setState({ S, user: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(h(MemoryRouter, { initialEntries: ['/plan/r/r_as'] },
      h(Routes, null, h(Route, { path: '/plan/r/:id', element: h(RoutineEdit) })))))
  }
  afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); root = null })
  const live = () => routine(useStore.getState().S)
  const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

  it('a rename and the deload switch keep the marker, and do not count as changing it', () => {
    mount(profile())
    const input = host.querySelector('.hdr input.input')
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Legs, my way')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(live().name).toBe('Legs, my way')
    act(() => rowTitled('Deload routine').querySelector('[role="switch"]').click())
    expect(live().excludeFromProgression).toBe(true)
    expect(live()[ASSIGNED]).toEqual(mark())
    expect(live()._f?.[ASSIGNED]).toBeUndefined()
  })

  it('editing an exercise keeps the routine\'s marker but rebuilds the slot: extra slot fields are dropped', () => {
    const S = profile()
    routine(S).ex[1].trainerNote = 'kept on the slot by nobody'
    mount(S)
    const rows = host.querySelectorAll('[data-routine-row] .item')
    act(() => rows[1].click())
    const onSave = sheets.exConfigSheet.mock.calls.at(-1)[2]
    act(() => onSave({ sets: 5, mode: 'reps', reps: 3, weight: 110 }))
    expect(live().ex[1]).toEqual({ id: SQUAT, sets: 5, mode: 'reps', reps: 3, weight: 110 })
    expect(live()[ASSIGNED]).toEqual(mark())
  })

  it('copyRoutine copies the marker onto the copy, under a new id', () => {
    const copy = copyRoutine(routine(profile()))
    expect(copy.id).not.toBe('r_as')
    expect(copy[ASSIGNED]).toEqual(mark())
  })
})

/* ------------------------------------------------------- the plan-share bundle and mergePlan */

describe('the plan-share format the module publishes in', () => {
  const bundle = () => ({
    opengym_plan: 1, name: 'Block 1', unit: 'kg',
    week: { 1: ['t_a'] },
    routines: [{ id: 't_a', name: 'A', emoji: 'dumbbell', [ASSIGNED]: mark(), ex: [{ id: 'tx_squat', sets: 3, reps: 5, slotKey: 's1' }, { id: SQUAT, sets: 3, reps: 5, weight: 100 }] }],
    customEx: [{ id: 'tx_squat', n: 'Trainer split squat', bp: 'upper legs', eq: 'dumbbell', media: { hash: 'a'.repeat(64) }, [ASSIGNED]: exMark() }],
  })

  it('parsePlan validates and converts, and keeps fields it does not know on routines, slots and custom exercises', () => {
    const p = parsePlan(bundle(), 'lb')
    expect(p.routines[0][ASSIGNED]).toEqual(mark())
    expect(p.routines[0].ex[0].slotKey).toBe('s1')
    expect(p.routines[0].ex[1].weight).not.toBe(100)   // kg → lb
    expect(p.customEx[0][ASSIGNED]).toEqual(exMark())
    expect(p.customEx[0].media).toEqual({ hash: 'a'.repeat(64) })
    expect(p.unit).toBe('lb')
    // An exercise id the file cannot resolve is dropped, not kept as a blank slot.
    const bad = bundle(); bad.routines[0].ex.push({ id: 'nope', sets: 1 })
    expect(parsePlan(bad, 'kg').dropped).toBe(1)
    expect(() => parsePlan({ routines: [] }, 'kg')).toThrow()
  })

  it('buildPlanBundle (Share plan) leaves the marker out, so a client sharing a plan shares no trainer data', () => {
    const b = buildPlanBundle(profile(), 'mine')
    expect(b.opengym_plan).toBe(1)
    expect(b.routines.every(r => !(ASSIGNED in r))).toBe(true)
    expect(b.customEx.every(c => !(ASSIGNED in c))).toBe(true)
  })

  it('mergePlan always adds new routines with fresh ids, drops the marker and reuses a same-named custom exercise: the module cannot apply a revision with it', () => {
    const s = profile()
    const before = s.routines.length
    mergePlan(s, parsePlan(bundle(), 'kg'), { schedule: true })
    expect(s.routines.length).toBe(before + 1)
    const added = s.routines.at(-1)
    expect(added.id).not.toBe('t_a')
    expect(ASSIGNED in added).toBe(false)
    // The bundle's custom exercise matched the client's one of the same name and body part.
    expect(added.ex[0].id).toBe('c_t1')
    expect(s.customEx).toHaveLength(1)
    // With the schedule switch the shared week replaces the client's week.
    expect(s.week).toEqual({ 1: [added.id] })
  })
})

/* -------------------------------------------------- the Coach's snapshot, and deleteRoutine */

describe('the Coach\'s snapshot and revert, which an applied assignment will use', () => {
  it('pushSnapshot keeps a deep copy of routines and week, marker included, at most SNAPSHOT_MAX', () => {
    const s = profile()
    pushSnapshot(s, 'trainer:as_1:1', 'Before the trainer\'s plan')
    routine(s)[ASSIGNED] = mark(2)
    routine(s).name = 'Changed'
    s.week = {}
    const snap = s.coach.snapshots.at(-1)
    expect(snap).toMatchObject({ proposalId: 'trainer:as_1:1', label: 'Before the trainer\'s plan' })
    expect(snap.routines.find(r => r.id === 'r_as')[ASSIGNED]).toEqual(mark())
    expect(SNAPSHOT_MAX).toBe(3)
    for (let i = 0; i < 5; i++) pushSnapshot(s, 'p' + i, '')
    expect(s.coach.snapshots).toHaveLength(SNAPSHOT_MAX)
  })

  it('revertLast puts routines and week back (not custom exercises), and says so in the Coach log', () => {
    const s = profile()
    expect(canRevert(s)).toBe(false)
    expect(revertLast(s)).toBe(false)
    pushSnapshot(s, 'trainer:as_1:2', '')
    deleteRoutine(s, 'r_as')
    s.customEx.push({ id: 'c_new', n: 'New', bp: 'back', custom: true })
    expect(canRevert(s)).toBe(true)
    expect(revertLast(s)).toBe(true)
    expect(routine(s)[ASSIGNED]).toEqual(mark())
    expect(s.week).toEqual(profile().week)
    expect(s.customEx.map(c => c.id)).toEqual(['c_t1', 'c_new'])
    expect(s.coach.log.at(-1)).toMatchObject({ kind: 'revert', proposalId: 'trainer:as_1:2' })
  })

  it('deleteRoutine takes a routine out of the list, every weekday and every reschedule', () => {
    const s = profile({ week: { 1: ['r_as', 'r_mine'], 3: ['r_as'] }, dayPlan: { '2026-10-09': 'r_as', '2026-10-10': 'rest' } })
    const dropped = deleteRoutine(s, 'r_as')
    expect(routine(s)).toBeUndefined()
    expect(s.week).toEqual({ 1: ['r_mine'] })
    expect(s.dayPlan).toEqual({ '2026-10-10': 'rest' })
    expect(dropped).toEqual({ '2026-10-09': 'r_as' })
  })
})

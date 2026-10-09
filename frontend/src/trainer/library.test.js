// @vitest-environment happy-dom
// The app's library gate (library.js) gives the server's answers (api/trainer/library.js) on the
// same inputs, and resolves what a slot names, built-in references through their catalogue.
import { describe, expect, it } from 'vitest'
import * as app from './library.js'
import * as server from '../../../api/trainer/library.js'
import { CATALOGUE, normalizeMediaRef } from './adapter.js'

const H = n => String(n).repeat(64).slice(0, 64)
const ref = {
  kind: 'video', hash: H('a'), mime: 'video/mp4', size: 4000, width: 640, height: 360, dur: 6.04, codec: 'avc1',
  poster: { hash: H('b'), mime: 'image/jpeg', size: 800, width: 480, height: 270 }, at: 1800000000000,
}
const TX1 = 'tx_' + '1'.repeat(16), TXA = 'tx_' + 'a'.repeat(16)
const R1 = 'tr_' + '0'.repeat(15) + '1', R2 = 'tr_' + '0'.repeat(15) + '2'
const exercises = new Map([[TX1, { id: TX1, archived: false }], [TXA, { id: TXA, archived: true }]])

/** The answer of one side: the value, or the refusal's code and field. */
const outcome = fn => { try { return { ok: fn() } } catch (e) { return { code: e.code, field: e.field, extra: e.extra } } }

describe('the same gate on both sides', () => {
  it('the bounds, id forms and catalogues are the server\'s', () => {
    expect({ ...app.LIMITS }).toEqual({ ...server.LIMITS })
    for (const k of ['EX_ID_RE', 'PROG_ID_RE', 'ROUTINE_ID_RE']) expect(app[k].source).toBe(server[k].source)
    expect(app.UNITS).toEqual(server.UNITS)
    expect(app.CURRENT_CATALOG).toBe(server.CURRENT_CATALOG)
    expect(Object.keys(app.CATALOGS)).toEqual(Object.keys(server.CATALOGS))
    for (const c of Object.keys(app.CATALOGS)) expect(app.CATALOGS[c].id.source).toBe(server.CATALOGS[c].source)
    for (const [id, cat] of [['0043', 'og1'], ['0043'], ['43', 'og1'], ['0043', 'og2'], [TX1, 'og1'], [null, 'og1'], ['0043', 'hasOwnProperty']]) {
      expect(app.builtinRef(id, cat), `${id} ${cat}`).toEqual(server.builtinRef(id, cat))
    }
  })

  it('a MediaRef: the server\'s cleanMediaRef is upstream\'s normalizeMediaRef', () => {
    const cases = [ref, { ...ref, extra: 1 }, { ...ref, dur: undefined, codec: undefined }, { ...ref, kind: 'image' }, { ...ref, mime: 'image/svg+xml' },
      { ...ref, hash: 'A'.repeat(64) }, { ...ref, size: 0 }, { ...ref, size: 1.5 }, { ...ref, width: 16385 }, { ...ref, dur: -1 }, { ...ref, dur: 3601 },
      { ...ref, codec: 'xvid' }, { ...ref, kind: 'image', mime: 'image/png', codec: 'avc1' }, { ...ref, poster: { ...ref.poster, mime: 'image/gif' } },
      { ...ref, poster: null }, { ...ref, at: 'now' }, { ...ref, at: 12.6 }, { kind: 'gif', hash: H('c'), mime: 'image/gif', size: 9, width: 1, height: 1 },
      null, [], 'x', { ...ref, mime: 'toString' }]
    for (const c of cases) expect(server.cleanMediaRef(c), JSON.stringify(c)).toEqual(normalizeMediaRef(c))
  })

  it('exercises: the same value or the same refusal', () => {
    const base = { n: 'Split squat', bp: 'upper legs', eq: 'dumbbell', desc: 'Line one\nline two', primaries: ['quadriceps'], secondaries: ['gluteal', 'quadriceps'] }
    const cases = [base, { ...base, extra: 1, id: 'x' }, { ...base, media: ref }, { ...base, media: { ...ref, mime: 'x' } }, { ...base, url: 'https://example.com' },
      { ...base, url: 'example.com' }, { ...base, url: 'ftp://example.com' }, { ...base, n: ' ' }, { ...base, n: 'a\tb' }, { ...base, n: 'x'.repeat(81) },
      { ...base, bp: '' }, { ...base, eq: null }, { ...base, desc: 'x'.repeat(1001) }, { ...base, desc: 'a\rb' }, { ...base, primaries: 'quads' },
      { ...base, secondaries: Array(17).fill('a') }, { ...base, primaries: [''] }, null, [], { n: 'Only a name', bp: 'back' }]
    for (const c of cases) expect(outcome(() => app.cleanExerciseInput(c)), JSON.stringify(c)?.slice(0, 80)).toEqual(outcome(() => server.cleanExerciseInput(c)))
  })

  it('programmes: the same value or the same refusal, with library, archived, built-in and unknown slots', () => {
    const r = (ex, over = {}) => ({ id: R1, name: 'Lower', emoji: 'dumbbell', ex, ...over })
    const p = (routines, over = {}) => ({ name: 'Block', unit: 'kg', routines, week: { 1: [R1] }, ...over })
    const cases = [
      [p([r([{ id: TX1, sets: 3, reps: 10, repsMin: 8, weight: 52.555, restSec: 90, note: ' slow ', sg: 'a1', side: true, extra: 1 }, { id: '0043', mode: 'time', sec: 45 }])])],
      [p([r([{ id: '0043', catalog: 'og1' }, { id: '9999' }])])],
      [p([r([{ id: '0043', catalog: 'og2' }])])],
      [p([r([{ id: TXA }])])], [p([r([{ id: TXA }])]), { allowArchived: new Set([TXA]) }], [p([r([{ id: TXA }])]), { allowArchived: true }],
      [p([r([{ id: 'tx_' + 'f'.repeat(16) }])])], [p([r([{ id: 'c123' }])])],
      [p([r([{ id: TX1, sets: 0 }])])], [p([r([{ id: TX1, reps: 8, repsMin: 8 }])])], [p([r([{ id: TX1, mode: 'cardio' }])])], [p([r([{ id: TX1, weight: 2001 }])])],
      [p([r([]), r([], { id: R2, name: 'Upper' })], { week: { 1: [R1, R2, R1], 5: R2 } })],
      [p([r([])], { week: { 8: [R1] } })], [p([r([])], { week: { 1: [R2] } })], [p([r([])], { unit: 'st' })], [p([r([])], { name: '' })],
      [p([r([], { emoji: 'a b' })])], [p(Array(15).fill(0).map((_, i) => r([], { id: 'tr_' + String(i).padStart(16, '0') })))],
      [p([r(Array(41).fill({ id: TX1 }))])], [p('x')], [null],
      // FIT-009: a run on a slot, kept, refused where it is wrong, or refused as too long with the note.
      [p([r([{ id: '0685', sets: 1, min: 40, note: 'Flat', run: { steps: [{ kind: 'warmup', km: 2.004, target: { zone: 2 }, _u: 'km' }, { kind: 'repeat', times: 5, work: { km: 1, target: { pace: 270, paceTo: 285 } }, rest: { sec: 90, how: 'jog' } }] } }])])],
      [p([r([{ id: TX1, run: { steps: [{ kind: 'easy', sec: 600, target: { kmh: 9.95 } }] } }])])],
      [p([r([{ id: '0685', run: { steps: [{ kind: 'easy', km: 1, target: { zone: 9 } }] } }])])],
      [p([r([{ id: '0685', run: { steps: [{ kind: 'repeat', times: 5, work: { km: 1 }, rest: { how: 'jog' } }] } }])])],
      [p([r([{ id: '0685', run: 'fast' }])])], [p([r([{ id: '0685', note: 'x'.repeat(480), run: { steps: [{ kind: 'easy', km: 5 }] } }])])],
    ]
    for (const [c, opts = {}] of cases) {
      expect(outcome(() => app.cleanProgrammeInput(c, { exercises, ...opts })), JSON.stringify(c)?.slice(0, 100)).toEqual(outcome(() => server.cleanProgrammeInput(c, { exercises, ...opts })))
    }
  })

  it('routine ids minted here have the server\'s form, so the week can name a routine before it is saved', () => {
    const a = app.newRoutineId(), b = app.newRoutineId()
    expect(a).toMatch(server.ROUTINE_ID_RE)
    expect(a).not.toBe(b)
    const kept = server.cleanProgrammeInput({ name: 'P', routines: [{ id: a, name: 'A', ex: [] }], week: { 2: [a] } })
    expect(kept.routines[0].id).toBe(a)
    expect(kept.week).toEqual({ 2: [a] })
  })
})

describe('what a slot names', () => {
  const lib = new Map([[TX1, { id: TX1, n: 'Split squat', archived: false }], [TXA, { id: TXA, n: 'Old one', archived: true }]])

  it('the catalogue the app runs with is og1, the one its built-in references were taken from', () => {
    expect(app.catalogFingerprint(CATALOGUE)).toBe(app.CATALOGS.og1.fingerprints[0])
    expect(app.resolveBuiltin({ id: '0043', catalog: 'og1' })?.id).toBe('0043')
  })

  it('library exercises (archived ones too), and built-in ones through their catalogue', () => {
    expect(app.resolveSlot({ id: TX1 }, lib)).toEqual({ kind: 'library', ex: lib.get(TX1) })
    expect(app.resolveSlot({ id: TXA }, lib)).toEqual({ kind: 'library', ex: lib.get(TXA) })
    const b = app.resolveSlot({ id: '0043', catalog: 'og1' }, lib)
    expect(b.kind).toBe('builtin')
    expect(b.ex).toBe(CATALOGUE.find(e => e.id === '0043'))
  })

  it('an unknown built-in id, an unknown catalogue or a renumbered catalogue: "unknown", never a crash and never the wrong exercise', () => {
    expect(app.resolveSlot({ id: '9999', catalog: 'og1' }, lib)).toEqual({ kind: 'unknown', id: '9999', catalog: 'og1' })
    expect(app.resolveSlot({ id: '0043', catalog: 'og2' }, lib)).toEqual({ kind: 'unknown', id: '0043', catalog: 'og2' })
    expect(app.resolveSlot({ id: '0043' }, lib)).toEqual({ kind: 'unknown', id: '0043', catalog: null })
    expect(app.resolveSlot({ id: 'tx_' + 'f'.repeat(16) }, lib)).toEqual({ kind: 'unknown', id: 'tx_' + 'f'.repeat(16), catalog: null })
    expect(app.resolveSlot({}, lib)).toEqual({ kind: 'unknown', id: '', catalog: null })
    expect(app.resolveSlot(null, lib)).toEqual({ kind: 'unknown', id: '', catalog: null })
    // The catalogue of a later upstream release: same id form, different exercises behind the ids.
    const renumbered = CATALOGUE.slice(0, 900).map((e, i) => ({ ...e, id: String(i + 1).padStart(4, '0') }))
    expect(app.resolveSlot({ id: '0043', catalog: 'og1' }, lib, renumbered)).toEqual({ kind: 'unknown', id: '0043', catalog: 'og1' })
  })

  it('a picked exercise becomes a slot: by id for the library, with its catalogue for a built-in one', () => {
    expect(app.slotFor({ id: TX1 })).toEqual({ id: TX1, sets: 3, reps: 10 })
    expect(app.slotFor({ id: '0043' }, { sets: 5, reps: 5 })).toEqual({ id: '0043', catalog: 'og1', sets: 5, reps: 5 })
    expect(() => app.slotFor({ id: 'c123' })).toThrow(app.LibraryError)
    expect([...app.programmeExerciseIds({ routines: [{ ex: [{ id: TX1 }, { id: '0043' }, { id: TX1 }] }] })]).toEqual([TX1])
  })
})

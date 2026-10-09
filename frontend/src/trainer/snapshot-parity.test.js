// @vitest-environment happy-dom
// The server's snapshot (api/trainer/snapshot.js), pinned against the app's (snapshot.js).
//
// The server builds what it publishes from the trainer's library, and never takes a snapshot an
// app sent. The app keeps its own copy for the trainer's preview and for its tests. The api image
// has no build step in common with the frontend, so the server's is a port; what must not happen
// is the two drifting, which is how upstream's coach-parity.test.js came to exist. This runs both
// over the same libraries and wants byte-identical JSON, `unresolved` included: the server's og1
// id list (api/trainer/catalog-og1.js) has to say what the app's catalogue says.
import { describe, expect, it } from 'vitest'
import { snapshotProgramme as appSnapshot, customExOf as appCustomEx } from './snapshot.js'
import { snapshotProgramme as serverSnapshot, customExOf as serverCustomEx, snapshotHashes } from '../../../api/trainer/snapshot.js'
import { resolveBuiltin as serverResolve } from '../../../api/trainer/library.js'
import { resolveBuiltin as appResolve } from './library.js'
import { CATALOGUE } from './adapter.js'

const TRAINER = 'u_trainer'
const TX = n => 'tx_' + String(n).repeat(16).slice(0, 16)
const TP = n => 'tp_' + String(n).repeat(16).slice(0, 16)
const TR = n => 'tr_' + String(n).padStart(16, '0')
const media = (h, poster) => ({
  kind: 'video', hash: h.repeat(64), mime: 'video/mp4', size: 4000, width: 640, height: 360, dur: 6, codec: 'avc1',
  ...(poster ? { poster: { hash: poster.repeat(64), mime: 'image/jpeg', size: 800, width: 480, height: 270 } } : {}), at: 1800000000000,
})
const ex = (id, rev, over = {}) => ({ id, rev, n: 'Exercise ' + id.slice(-2), bp: 'upper legs', eq: '', desc: '', primaries: [], secondaries: [], archived: false, createdAt: 1, updatedAt: 2, ...over })

function library() {
  return {
    v: 1, rev: 9, wid: 'ab'.repeat(8), owner: TRAINER,
    exercises: [
      ex(TX(1), 3, { n: 'Split squat', eq: 'dumbbell', desc: 'Front shin vertical.\nDrive through the heel.', primaries: ['quadriceps', 'gluteal'], secondaries: ['hamstrings'], media: media('a', 'b') }),
      ex(TX(2), 1, { n: 'Copenhagen plank', bp: 'waist', eq: 'body weight', url: 'https://example.org/cph' }),
      ex(TX(3), 7, { n: 'Archived but used', archived: true, media: { kind: 'image', hash: 'c'.repeat(64), mime: 'image/jpeg', size: 9, width: 2, height: 2, at: 0 } }),
      ex(TX(4), 1, { n: 'Unused' }),
    ],
    programmes: [
      {
        id: TP(1), rev: 4, name: 'Block 1', unit: 'kg', archived: false, createdAt: 1, updatedAt: 2,
        routines: [
          { id: TR(1), name: 'Lower', emoji: 'dumbbell', ex: [{ id: TX(1), sets: 3, reps: 8, weight: 20, note: 'Slow down' }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, repsMin: 3, weight: 100, restSec: 180, warmupSets: 2 }] },
          { id: TR(2), name: 'Core', ex: [{ id: TX(2), sets: 3, sec: 30, mode: 'time', side: true }, { id: TX(3), sets: 2, reps: 10, bodyweight: true }, { id: TX(1), sets: 1, reps: 20, sg: 'a' }] },
          { id: TR(3), name: 'Empty', ex: [] },
          // FIT-009: runs planned in steps, with and without instructions of the trainer's own.
          { id: TR(4), name: 'Run', ex: [
            { id: '0685', catalog: 'og1', sets: 1, min: 40, note: 'Flat route', run: { steps: [{ kind: 'warmup', km: 2, target: { zone: 2 } }, { kind: 'repeat', times: 5, work: { km: 1, target: { pace: 270, paceTo: 285 } }, rest: { sec: 90, how: 'jog' } }, { kind: 'cooldown', km: 1 }] } },
            { id: TX(2), sets: 1, run: { steps: [{ kind: 'easy', sec: 1800, target: { kmh: 10.5 } }] } },
          ] },
        ],
        week: { 1: [TR(1)], 4: [TR(2), TR(3)] },
      },
      {
        id: TP(2), rev: 1, name: 'Broken', unit: 'lb', archived: true, createdAt: 1, updatedAt: 1,
        routines: [{ id: TR(9), name: 'A', ex: [{ id: '9999', catalog: 'og1', sets: 2 }, { id: TX(8), sets: 1 }, { id: '0001', catalog: 'og1' }, { id: '0043', catalog: 'og2' }, { id: '0001' }] }],
        week: {},
      },
      { id: TP(3), rev: 2, name: 'No week', unit: 'kg', archived: false, createdAt: 1, updatedAt: 1, routines: [{ id: TR(5), name: 'B', ex: [{ id: '0025', catalog: 'og1', sets: 5, reps: 5 }] }] },
    ],
  }
}

const both = (lib, id, opts) => [JSON.stringify(serverSnapshot(lib, id, opts)), JSON.stringify(appSnapshot(lib, id, opts))]

describe('the server\'s snapshot and the app\'s agree', () => {
  it('on every programme, with and without an assignment id and revision', () => {
    for (const id of [TP(1), TP(2), TP(3)]) {
      for (const opts of [{}, { assignmentId: 'lk_' + 'e'.repeat(16), rev: 3 }, { trainer: 'u_other', rev: 0 }]) {
        const [server, app] = both(library(), id, opts)
        expect(server, `${id} ${JSON.stringify(opts)}`).toBe(app)
      }
    }
  })

  it('the cases that matter: archived exercises, unknown library and built-in ids, an unknown catalogue, no catalogue', () => {
    const snap = serverSnapshot(library(), TP(2))
    expect(snap.unresolved).toEqual([
      { routine: TR(9), index: 0, id: '9999', catalog: 'og1' },
      { routine: TR(9), index: 1, id: TX(8), catalog: null },
      { routine: TR(9), index: 3, id: '0043', catalog: 'og2' },
      { routine: TR(9), index: 4, id: '0001', catalog: null },
    ])
    expect(snap.routines[0].ex).toEqual([{ id: '0001', catalog: 'og1' }])
    expect(serverSnapshot(library(), TP(1)).customEx.map(c => c.id)).toEqual([TX(1), TX(2), TX(3)])
    expect([...snapshotHashes(serverSnapshot(library(), TP(1)))]).toEqual(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])
  })

  it('customExOf, exercise by exercise', () => {
    for (const e of library().exercises) expect(JSON.stringify(serverCustomEx(e, TRAINER))).toBe(JSON.stringify(appCustomEx(e, TRAINER)))
  })

  it('built-in resolution, over the whole catalogue and some that are not in it', () => {
    const ids = [...CATALOGUE.map(e => e.id), '0000', '0004', '0005', '9999', '5202', 'abcd', '43', '00430']
    for (const id of ids) {
      for (const catalog of ['og1', 'og2', undefined]) {
        const s = serverResolve({ id, catalog })
        const a = appResolve({ id, catalog })
        expect(s ? s.id : null, `${id} ${catalog}`).toBe(a ? a.id : null)
      }
    }
  })

  it('errors the same way', () => {
    for (const [lib, id, opts] of [[library(), TP(9), {}], [{ ...library(), owner: undefined }, TP(1), {}]]) {
      const s = (() => { try { serverSnapshot(lib, id, opts) } catch (e) { return e.code } })()
      const a = (() => { try { appSnapshot(lib, id, opts) } catch (e) { return e.code } })()
      expect(s).toBe(a)
      expect(s).toBeTruthy()
    }
  })
})

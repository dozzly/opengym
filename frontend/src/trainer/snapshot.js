// The durable snapshot of a trainer's programme, and how a client's own app puts one in place
// (ADR 029, decision 5). FIT-003 builds and tests the core; FIT-004 delivers it (publish, the
// client's Apply/Discard or trainer-managed apply, and the acknowledgement).
//
// snapshotProgramme(library, programmeId) is a self-contained copy of one programme as it is now:
// upstream-shaped routines, and every library exercise they use as a full custom-exercise snapshot
// under its stable tx_ id (custom: true, its MediaRef, and src: { trainer, exRev }). It is a deep
// copy, so editing, archiving or deleting the library later changes nothing in it: a client keeps
// the exercise as it was published until the trainer publishes again.
//
// applySnapshot(state, snapshot, { previousRoutineIds }) puts it into a client's profile (a draft
// inside the store's update(), like upstream's mergePlan). Upstream's mergePlan cannot do this: it
// mints fresh ids, drops fields it does not know and reuses a same-named custom exercise
// (contract.test.js). So this is the module's own replace-in-place:
//   - Only routines whose ids the module recorded for the previous revision are replaced or
//     removed, in place, keeping their ids, so the workouts logged against them and their
//     progression stay attached. A copy the client made (copyRoutine copies the marker) and every
//     personal routine are left alone, whatever they carry.
//   - The snapshot's custom exercises are upserted by id. None is ever removed, so history that
//     names an exercise a newer revision dropped still resolves.
//   - Nothing else is touched: workouts, weigh-ins, settings, other custom exercises, the week
//     (beyond upstream's own clean-up of a removed routine), the Coach's snapshots.
//   - Units are converted, and every exercise id checked, by upstream's parsePlan.
// It refuses, before changing anything, a snapshot whose routine or exercise id is already taken
// by something that is not the module's: that is not something to overwrite.
//
// Nothing is kept on an exercise slot: upstream's routine editor rebuilds a slot when its exercise
// is edited, and drops what it does not know.
import { parsePlan, deleteRoutine, ASSIGNED } from './adapter.js'
import { EX_ID_RE, resolveBuiltin, byId } from './library.js'

export const SNAPSHOT_FORMAT = 1

const clone = v => JSON.parse(JSON.stringify(v))
const fail = (code, message) => Object.assign(new Error(message), { code })

/** A library exercise as a client's custom exercise: upstream's CustomExForm shape, plus `src`. */
export function customExOf(ex, trainer) {
  const primaries = [...(ex.primaries || [])]
  const secondaries = [...(ex.secondaries || [])]
  return {
    id: ex.id, n: ex.n, bp: ex.bp, eq: ex.eq || '', desc: ex.desc || '',
    tg: primaries[0] || '', primaries, secondaries, sm: [...secondaries], muscleGroups: [...primaries, ...secondaries],
    ...(ex.url ? { url: ex.url } : {}),
    ...(ex.media ? { media: clone(ex.media) } : {}),
    custom: true,
    src: { trainer, exRev: ex.rev },
  }
}

/**
 * The snapshot of one programme of `library` (the GET /api/trainer/library answer):
 *   { trainer_snapshot: 1, opengym_plan: 1, trainer, programme: { id, rev }, name, unit,
 *     routines, customEx, week, unresolved }
 * `routines` carry the marker `assigned: { by, assignmentId, rev }` (assignmentId defaults to the
 * programme's id and rev to its revision until FIT-004 has assignments). A slot naming a built-in
 * exercise that the app cannot resolve in the catalogue it was taken from cannot be delivered: it
 * is left out of the routine and listed in `unresolved` ({ routine, index, id, catalog }), for the
 * publishing screen to stop on. Archived library exercises are delivered like any other.
 */
export function snapshotProgramme(library, programmeId, { trainer = library?.owner, assignmentId, rev, catalogue } = {}) {
  if (!trainer) throw fail('no-trainer', 'whose library this is must be known')
  const p = (library?.programmes || []).find(x => x.id === programmeId)
  if (!p) throw fail('not-found', 'no such programme')
  const exercises = byId(library.exercises)
  const used = []
  const unresolved = []
  const routines = p.routines.map(r => {
    const ex = []
    r.ex.forEach((slot, index) => {
      const { id, catalog, ...cfg } = slot
      if (EX_ID_RE.test(id)) {
        const lib = exercises.get(id)
        if (!lib) { unresolved.push({ routine: r.id, index, id, catalog: null }); return }
        if (!used.includes(lib)) used.push(lib)
        ex.push({ id, ...cfg })
        return
      }
      const builtin = resolveBuiltin({ id, catalog }, ...(catalogue ? [catalogue] : []))
      if (!builtin) { unresolved.push({ routine: r.id, index, id, catalog: catalog ?? null }); return }
      ex.push({ id: builtin.id, ...cfg })
    })
    return {
      id: r.id, name: r.name, ...(r.emoji ? { emoji: r.emoji } : {}),
      [ASSIGNED]: { by: trainer, assignmentId: assignmentId || p.id, rev: rev ?? p.rev },
      ex,
    }
  })
  return clone({
    trainer_snapshot: SNAPSHOT_FORMAT, opengym_plan: 1,
    trainer, programme: { id: p.id, rev: p.rev }, name: p.name, unit: p.unit,
    routines, customEx: used.map(e => customExOf(e, trainer)), week: p.week || {}, unresolved,
  })
}

// The sync bookkeeping an entry carries (_ts, _f, _u): kept across a replace, so the store's
// stampChange sees the replace as the edit it is.
const stampsOf = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k.startsWith('_')))

/**
 * Puts `snapshot` into the client profile `s` (a draft: call it inside the store's update()).
 * `previousRoutineIds` are the routine ids the module recorded when it applied the previous
 * revision. Returns { routineIds, customExIds, added, replaced, removed, dropped }: record
 * `routineIds` for the next revision; `dropped` counts slots upstream's parsePlan could not
 * resolve on this device. Throws { code: 'not-snapshot' | 'id-collision' } before changing anything.
 */
export function applySnapshot(s, snapshot, { previousRoutineIds = [] } = {}) {
  if (!snapshot || snapshot.trainer_snapshot !== SNAPSHOT_FORMAT || !Array.isArray(snapshot.routines)) throw fail('not-snapshot', 'not a trainer snapshot')
  const plan = parsePlan({ opengym_plan: 1, unit: snapshot.unit, routines: snapshot.routines, customEx: snapshot.customEx || [], week: {} }, s.unit == null ? 'kg' : s.unit)
  const prev = new Set(previousRoutineIds)
  s.routines = s.routines || []
  s.customEx = s.customEx || []
  for (const r of plan.routines) {
    if (s.routines.some(x => x.id === r.id) && !prev.has(r.id)) throw fail('id-collision', `routine ${r.id} is not one the module delivered`)
  }
  for (const c of plan.customEx) {
    const cur = s.customEx.find(x => x.id === c.id)
    if (cur && cur.src?.trainer !== c.src?.trainer) throw fail('id-collision', `custom exercise ${c.id} is not this trainer's`)
  }

  for (const c of plan.customEx) {
    const i = s.customEx.findIndex(x => x.id === c.id)
    if (i < 0) s.customEx.push(clone(c))
    else s.customEx[i] = { ...stampsOf(s.customEx[i]), ...clone(c) }
  }
  const incoming = new Set(plan.routines.map(r => r.id))
  const removed = []
  for (const id of prev) {
    if (!incoming.has(id) && s.routines.some(r => r.id === id)) { deleteRoutine(s, id); removed.push(id) }
  }
  let added = 0, replaced = 0
  const gone = s.deleted && typeof s.deleted.routines === 'object' ? s.deleted.routines : {}
  for (const r of plan.routines) {
    const i = s.routines.findIndex(x => x.id === r.id)
    if (i >= 0) { s.routines[i] = { ...stampsOf(s.routines[i]), ...clone(r) }; replaced++; continue }
    const next = clone(r)
    // A routine this client deleted, delivered again: newer than its removal, or the store's
    // stamping reads it as an Undo putting the old one back and the next merge removes it again.
    if (Number(gone[r.id]) > 0) next._ts = Number(gone[r.id]) + 1
    s.routines.push(next)
    added++
  }
  return { routineIds: [...incoming], customExIds: plan.customEx.map(c => c.id), added, replaced, removed, dropped: plan.dropped }
}

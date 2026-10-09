// What changes between two versions of an assigned plan, for a person to read before it happens:
// the trainer before publishing (the current published snapshot against the server's preview of
// the draft), and a co-managed client before applying (what it holds against what Apply would
// write, snapshot.js deliverable()). Pure.
//
//   diffPlans(before, after) → {
//     routines:  { added: [{ id, name }], removed: [{ id, name }],
//                  changed: [{ id, name, renamed, emoji, reordered, exercises: { added, removed, changed } }] },
//     exercises: { added: [{ id, name }], removed: [{ id, name }], revised: [{ id, name, from, to }] },
//     empty }
//
// `before` and `after` are { routines, customEx }, either of them null for "nothing yet". A routine
// is matched by id (the module keeps ids stable across revisions); its exercise slots by exercise
// id, in order, so a slot whose sets, reps, weight or instructions (`note`) moved is `changed`, and the same slots in
// another order are `reordered`. `exercises` are the trainer's own (custom exercises with `src`):
// `revised` is a new revision of one the plan already had (src.exRev went up). Bookkeeping fields
// (`_ts`, `_f`, the delivery marker) are never a change.

const SKIP = new Set(['id', 'assigned'])
const content = o => JSON.stringify(Object.keys(o || {}).filter(k => !SKIP.has(k) && !k.startsWith('_')).sort().map(k => [k, o[k]]))
const list = v => (Array.isArray(v) ? v : [])

/** Slot changes between two routines' `ex`: ids added, removed, changed; and whether the order moved. */
export function slotChanges(beforeEx, afterEx) {
  const count = l => l.reduce((m, s) => m.set(s.id, (m.get(s.id) || 0) + 1), new Map())
  const b = list(beforeEx).filter(s => s && s.id != null), a = list(afterEx).filter(s => s && s.id != null)
  const cb = count(b), ca = count(a)
  const added = [...ca.keys()].filter(id => (ca.get(id) || 0) > (cb.get(id) || 0))
  const removed = [...cb.keys()].filter(id => (cb.get(id) || 0) > (ca.get(id) || 0))
  // The n-th slot of an exercise in one, against its n-th in the other.
  const nth = l => { const seen = new Map(); return l.map(s => { const n = seen.get(s.id) || 0; seen.set(s.id, n + 1); return [s.id + '#' + n, s] }) }
  const nb = new Map(nth(b)), na = nth(a)
  const changed = [...new Set(na.filter(([k, s]) => nb.has(k) && content(nb.get(k)) !== content(s)).map(([, s]) => s.id))]
  const common = l => l.filter(s => cb.has(s.id) && ca.has(s.id)).map(s => s.id).join(',')
  const reordered = !added.length && !removed.length && common(b) !== common(a)
  return { added, removed, changed, reordered }
}

export function diffPlans(before, after) {
  const bR = list(before?.routines), aR = list(after?.routines)
  const byId = l => new Map(l.filter(x => x && x.id != null).map(x => [x.id, x]))
  const mb = byId(bR), ma = byId(aR)
  const routines = {
    added: aR.filter(r => !mb.has(r.id)).map(r => ({ id: r.id, name: r.name })),
    removed: bR.filter(r => !ma.has(r.id)).map(r => ({ id: r.id, name: r.name })),
    changed: [],
  }
  for (const r of aR) {
    const old = mb.get(r.id)
    if (!old) continue
    const ex = slotChanges(old.ex, r.ex)
    const renamed = old.name !== r.name ? old.name : null
    const emoji = (old.emoji || null) !== (r.emoji || null)
    if (renamed != null || emoji || ex.reordered || ex.added.length || ex.removed.length || ex.changed.length) {
      routines.changed.push({ id: r.id, name: r.name, renamed, emoji, reordered: ex.reordered, exercises: { added: ex.added, removed: ex.removed, changed: ex.changed } })
    }
  }
  const bC = byId(list(before?.customEx)), aC = byId(list(after?.customEx))
  const exercises = {
    added: [...aC.values()].filter(c => !bC.has(c.id)).map(c => ({ id: c.id, name: c.n })),
    removed: [...bC.values()].filter(c => !aC.has(c.id)).map(c => ({ id: c.id, name: c.n })),
    revised: [],
  }
  for (const c of aC.values()) {
    const old = bC.get(c.id)
    if (!old) continue
    const from = old.src?.exRev ?? null, to = c.src?.exRev ?? null
    if (from !== to || (from == null && content(old) !== content(c))) exercises.revised.push({ id: c.id, name: c.n, from, to })
  }
  const empty = !routines.added.length && !routines.removed.length && !routines.changed.length &&
    !exercises.added.length && !exercises.removed.length && !exercises.revised.length
  return { routines, exercises, empty }
}

/** What a client holds of the link's plan: the routines it recorded for it, and the trainer's
 *  exercises in its profile. */
export function heldPlan(S, routineIds, trainer) {
  const ids = new Set(routineIds || [])
  return {
    routines: list(S?.routines).filter(r => r && ids.has(r.id)),
    customEx: list(S?.customEx).filter(c => c && c.src && c.src.trainer === trainer),
  }
}

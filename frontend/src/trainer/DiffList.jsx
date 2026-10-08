// A diff (diff.js) as sentences: what publishing, or applying, would change. Exercise names come
// from the plan itself for the trainer's own exercises and from upstream's catalogue for built-in
// ones (exerciseLabel).
import { exerciseNameFor } from './adapter.js'
import { catalogueEntry } from './library.js'
import { LINK_TEXT as T } from './strings.js'

/** A display name for an exercise id in a plan or a log: a trainer's exercise by the name the plan
 *  carries, a built-in one by upstream's own name, anything else as `fallback`. */
export function exerciseLabel(id, customEx = [], fallback = T.ownExercise) {
  const c = (customEx || []).find(x => x && x.id === id)
  if (c?.n) return c.n
  const b = catalogueEntry(id)
  return b ? exerciseNameFor(b) : fallback
}

/** The diff's lines, in reading order. */
export function diffLines(diff, nameOf, { showUnused = false } = {}) {
  const names = ids => ids.map(nameOf).join(', ')
  const lines = []
  for (const r of diff.routines.added) lines.push(T.newRoutine(r.name))
  for (const r of diff.routines.removed) lines.push(T.removedRoutine(r.name))
  for (const r of diff.routines.changed) {
    const parts = []
    if (r.renamed != null) parts.push(T.renamedFrom(r.renamed))
    if (r.emoji) parts.push(T.newIcon)
    if (r.exercises.added.length) parts.push(T.added(names(r.exercises.added)))
    if (r.exercises.removed.length) parts.push(T.removed(names(r.exercises.removed)))
    if (r.exercises.changed.length) parts.push(T.changed(names(r.exercises.changed)))
    if (r.reordered) parts.push(T.reordered)
    lines.push(`${r.name}: ${parts.join('; ')}`)
  }
  for (const e of diff.exercises.added) lines.push(T.newExercise(e.name))
  for (const e of diff.exercises.revised) lines.push(T.revisedExercise(e.name, e.from, e.to))
  if (showUnused) for (const e of diff.exercises.removed) lines.push(T.unusedExercise(e.name))
  return lines
}

export default function DiffList({ diff, nameOf, showUnused }) {
  const lines = diffLines(diff, nameOf, { showUnused })
  if (!lines.length) return <p className="small trainer-diff" style={{ margin: '8px 16px', color: 'var(--label-2)' }}>{T.noChanges}</p>
  return <ul className="small trainer-diff" style={{ margin: '8px 16px', paddingLeft: 18 }}>
    {lines.map((line, i) => <li key={i} style={{ margin: '2px 0' }}>{line}</li>)}
  </ul>
}

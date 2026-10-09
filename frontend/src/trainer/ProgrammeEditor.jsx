// #/trainer/programmes/<id|new>: one programme. Routines whose exercise slots name a library
// exercise or a built-in one, picked from a search list of both; sets and reps (or seconds) per
// slot; save, archive, restore. The week and any slot settings this screen does not show are kept
// as the programme has them.
//
// The picker is the module's own short list rather than upstream's exercise picker: that one also
// lists the trainer's personal custom exercises and offers to create one in her own profile,
// neither of which may go into a programme.
import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button, CATALOGUE, Row, SearchField, Section, Segmented, TextArea, TextField, exerciseNameFor, searchExercises, vocabText } from './adapter.js'
import { LIMITS, LibraryError, byId, cleanProgrammeInput, newRoutineId, programmeExerciseIds, resolveSlot, slotFor } from './library.js'
import { writeErrorText } from './useTrainer.js'
import Page, { Note } from './Page.jsx'
import RunEditor from './RunEditor.jsx'
import ClimbEditor from './ClimbEditor.jsx'
import { TEXT, invalidText } from './strings.js'

const clone = v => JSON.parse(JSON.stringify(v))
const blank = () => ({ name: '', unit: 'kg', routines: [{ id: newRoutineId(), name: TEXT.dayName(1), ex: [] }], week: {} })
const contentOf = p => clone({ name: p.name, unit: p.unit, routines: p.routines, week: p.week || {} })

export default function ProgrammeEditor({ lib, write }) {
  const { id } = useParams()
  const nav = useNavigate()
  const existing = id === 'new' ? null : lib.programmes.find(p => p.id === id) || null
  const [draft, setDraft] = useState(() => (existing ? contentOf(existing) : blank()))
  const [picking, setPicking] = useState(null)   // the index of the routine the picker adds to
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const exercises = useMemo(() => byId(lib.exercises), [lib.exercises])
  if (id !== 'new' && !existing) return <Navigate to="/trainer" replace />

  const change = fn => setDraft(d => { const n = clone(d); fn(n); return n })
  const removeRoutine = i => change(d => {
    const [gone] = d.routines.splice(i, 1)
    for (const k of Object.keys(d.week)) {
      d.week[k] = [].concat(d.week[k]).filter(x => x !== gone.id)
      if (!d.week[k].length) delete d.week[k]
    }
  })

  const run = async (method, body) => {
    setBusy(true)
    setMsg(null)
    const r = await write('programmes', method, body)
    setBusy(false)
    if (r.ok) return r.item
    setMsg({ alert: writeErrorText(r) || invalidText(r.data) })
    return null
  }
  const save = async () => {
    let content
    // Archived exercises the stored programme already used stay allowed, as on the server.
    try { content = cleanProgrammeInput(draft, { exercises, allowArchived: existing ? programmeExerciseIds(existing) : null }) }
    catch (e) { if (e instanceof LibraryError) { setMsg({ alert: invalidText(e) }); return } throw e }
    const item = existing ? await run('PUT', { id: existing.id, programme: content }) : await run('POST', { programme: content })
    if (item) nav('/trainer')
  }
  const archive = async () => { if (await run('DELETE', { id: existing.id })) nav('/trainer') }
  const restore = async () => { if (await run('PUT', { id: existing.id, programme: contentOf(existing), archived: false })) setMsg({ status: TEXT.saved }) }

  return <Page title={existing ? TEXT.editProgramme : TEXT.newProgramme} back="/trainer" backLabel={TEXT.backToTrainer}>
    <Section>
      <div style={{ padding: '10px 16px', display: 'grid', gap: 10 }}>
        <label htmlFor="trainer-prog-name" className="small dim">{TEXT.programmeName}</label>
        <TextField id="trainer-prog-name" maxLength={LIMITS.name} value={draft.name} onChange={e => change(d => { d.name = e.target.value })} />
        <span className="small dim" id="trainer-prog-unit">{TEXT.unit}</span>
        <Segmented options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={draft.unit} onChange={v => change(d => { d.unit = v })} />
      </div>
    </Section>

    {draft.routines.map((r, ri) => <Section key={r.id} title={`${TEXT.routine} ${ri + 1}`}>
      <div style={{ padding: '10px 16px' }}>
        <TextField aria-label={TEXT.routineName} maxLength={LIMITS.name} value={r.name} onChange={e => change(d => { d.routines[ri].name = e.target.value })} />
      </div>
      {r.ex.map((slot, si) => <SlotRow key={si} slot={slot} what={resolveSlot(slot, exercises)}
        onChange={patch => change(d => { Object.assign(d.routines[ri].ex[si], patch); for (const k of Object.keys(patch)) if (patch[k] == null) delete d.routines[ri].ex[si][k] })}
        onRemove={() => change(d => { d.routines[ri].ex.splice(si, 1) })} />)}
      {picking === ri
        ? <Picker lib={lib} onPick={ex => { change(d => { d.routines[ri].ex.push(slotFor(ex, isCardio(ex) ? (isClimbing(ex) ? CLIMB_SLOT : CARDIO_SLOT) : undefined)) }); setPicking(null) }} onClose={() => setPicking(null)} />
        : r.ex.length < LIMITS.slots && <Row icon="plusCircle" title={TEXT.addExercise} onClick={() => setPicking(ri)} />}
      {draft.routines.length > 1 && <Row icon="trash" danger title={TEXT.removeRoutine} onClick={() => removeRoutine(ri)} />}
    </Section>)}
    {draft.routines.length < LIMITS.routines && <Section>
      <Row icon="plusCircle" title={TEXT.addRoutine} onClick={() => change(d => { d.routines.push({ id: newRoutineId(), name: TEXT.dayName(d.routines.length + 1), ex: [] }) })} />
    </Section>}

    <Note alert>{msg?.alert}</Note>
    <Note>{msg?.status}</Note>
    <div style={{ display: 'grid', gap: 8, margin: '16px' }}>
      <Button variant="primary" disabled={busy} onClick={save}>{existing ? TEXT.save : TEXT.create}</Button>
      {existing && !existing.archived && <Button variant="danger" icon="trash" disabled={busy} onClick={archive}>{TEXT.archive}</Button>}
      {existing?.archived && <Button variant="tinted" disabled={busy} onClick={restore}>{TEXT.restore}</Button>}
    </div>
  </Page>
}

const num = v => (v === '' ? null : Number(v))
// Upstream logs cardio as duration and speed (lib/history.js defaultConfig: { sets: 1, min: 20,
// speed: 8 }); the speed is the client's to log, so a programme leaves it out.
const isCardio = ex => ex?.bp === 'cardio'
const CARDIO_SLOT = Object.freeze({ sets: 1, min: 20 })
// The built-in catalogue has no climbing, so a trainer adds an exercise to the library
// ("Bouldering", body part cardio so the client logs its time): a library exercise whose name says
// climbing gets a climbing session (FIT-010) instead of a run.
const CLIMB_NAME = /boulder|climb|klettern|escalade|\bbloc|arrampica/i
const isClimbing = ex => !!ex && !/^\d+$/.test(ex.id) && CLIMB_NAME.test(ex.n || '')
const CLIMB_SLOT = Object.freeze({ sets: 1, min: 90 })

/** One exercise slot: what it names (unknown ones say so and stay), sets and reps, seconds or (for
 *  cardio) minutes, and the trainer's instructions for it. Those travel with the plan as the slot's
 *  `note`, which upstream shows on the workout screen under the exercise ("the plan's
 *  instruction"): a run's paces, a bouldering session's grades and rest, a lift's cues. A cardio
 *  slot can also carry a run planned in steps (RunEditor.jsx), and a climbing one a climbing
 *  session (ClimbEditor.jsx), delivered as text ahead of them. */
function SlotRow({ slot, what, onChange, onRemove }) {
  const title = what.kind === 'library' ? what.ex.n + (what.ex.archived ? ` (${TEXT.archivedTag})` : '')
    : what.kind === 'builtin' ? exerciseNameFor(what.ex) : TEXT.unknownExercise(what.id)
  const timed = slot.mode === 'time'
  const cardio = isCardio(what.ex)
  const climbing = isClimbing(what.ex) || !!slot.climb
  return <div className="lrow" data-slot={slot.id} style={{ flexWrap: 'wrap', gap: 8 }}>
    <span className="lrow-m">
      <span className={'lrow-t' + (what.kind === 'builtin' ? ' capitalize' : '')}>{title}</span>
      {what.kind === 'unknown' && <span className="lrow-s">{TEXT.unknownHint}</span>}
    </span>
    <label className="small dim">{TEXT.sets}
      <input className="input" type="number" inputMode="numeric" min="1" max="20" style={{ width: 64, marginInlineStart: 6 }}
        value={slot.sets ?? ''} onChange={e => onChange({ sets: num(e.target.value) })} /></label>
    {cardio
      ? <label className="small dim">{TEXT.minutes}
        <input className="input" type="number" inputMode="decimal" min="0.5" style={{ width: 72, marginInlineStart: 6 }}
          value={slot.min ?? ''} onChange={e => onChange({ min: num(e.target.value) })} /></label>
      : timed
      ? <label className="small dim">{TEXT.seconds}
        <input className="input" type="number" inputMode="numeric" min="1" style={{ width: 72, marginInlineStart: 6 }}
          value={slot.sec ?? ''} onChange={e => onChange({ sec: num(e.target.value) })} /></label>
      : <label className="small dim">{TEXT.reps}
        <input className="input" type="number" inputMode="numeric" min="1" max="999" style={{ width: 64, marginInlineStart: 6 }}
          value={slot.reps ?? ''} onChange={e => onChange({ reps: num(e.target.value) })} /></label>}
    <Button size="sm" variant="ghost" onClick={onRemove}>{TEXT.removeExercise}</Button>
    <div style={{ flexBasis: '100%' }}>
      <TextArea aria-label={TEXT.slotInstructionsFor(title)} placeholder={TEXT.slotInstructionsHint} rows={2}
        maxLength={LIMITS.note} value={slot.note || ''} onChange={e => onChange({ note: e.target.value })} />
    </div>
    {climbing && !slot.run
      ? <div style={{ flexBasis: '100%' }}>
        <ClimbEditor climb={slot.climb || null} note={slot.note} title={title} onChange={climb => onChange({ climb })} />
      </div>
      : (cardio || slot.run) && <div style={{ flexBasis: '100%' }}>
        <RunEditor run={slot.run || null} note={slot.note} title={title} onChange={run => onChange({ run })} />
      </div>}
  </div>
}

/** Where a name matches a search: the whole name, its start, a word's start, anywhere. Upstream's
 *  search matches anywhere, so "run" listed thirty crunches before the run. */
export function matchRank(name, query) {
  const n = String(name || '').toLowerCase()
  return n === query ? 0 : n.startsWith(query) ? 1 : (' ' + n.replace(/[^\p{L}\p{N}]+/gu, ' ')).includes(' ' + query) ? 2 : 3
}
const ranked = (list, query, nameOf) => list.map((e, i) => [matchRank(nameOf(e), query), i, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2])

/** The trainer's library (not archived) first, then built-in exercises matching the search, the
 *  closest matches first. */
function Picker({ lib, onPick, onClose }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const mine = ranked(lib.exercises.filter(e => !e.archived && (!query || e.n.toLowerCase().includes(query))), query, e => e.n)
  const builtins = query ? ranked(searchExercises(CATALOGUE, q), query, exerciseNameFor).slice(0, 30) : []
  const item = (e, sub) => <button key={e.id} type="button" className="lrow tap" onClick={() => onPick(e)}>
    <span className="lrow-m"><span className="lrow-t">{sub ? exerciseNameFor(e) : e.n}</span><span className="lrow-s">{vocabText(e.bp)}</span></span>
  </button>
  return <div style={{ padding: '8px 0' }}>
    <div style={{ padding: '0 16px 8px' }}>
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={TEXT.search} aria-label={TEXT.search} autoFocus />
    </div>
    <div role="group" aria-label={TEXT.fromLibrary}>
      <p className="small dim" style={{ margin: '4px 16px' }}>{TEXT.fromLibrary}</p>
      {mine.length ? mine.map(e => item(e, false)) : <p className="small dim" style={{ margin: '4px 16px' }}>{TEXT.noMatches}</p>}
    </div>
    <div role="group" aria-label={TEXT.builtIn}>
      <p className="small dim" style={{ margin: '4px 16px' }}>{TEXT.builtIn}</p>
      {query ? (builtins.length ? builtins.map(e => item(e, true)) : <p className="small dim" style={{ margin: '4px 16px' }}>{TEXT.noMatches}</p>)
        : <p className="small dim" style={{ margin: '4px 16px' }}>{TEXT.typeToSearch}</p>}
    </div>
    <div style={{ padding: '4px 16px' }}><Button size="sm" variant="ghost" onClick={onClose}>{TEXT.close}</Button></div>
  </div>
}

// #/trainer/clients/<link>: one linked client, from the trainer's side (FIT-004).
//
//   - the link: the client's mode, body-weight sharing, and what became of the last revision;
//   - Assign programme: a non-archived programme of the library becomes the draft, with a note;
//   - Review and publish: the server's preview of the draft against the current published
//     revision (routines and exercises added, removed or changed; exercise revisions), then
//     Publish. Built-in exercises the catalogue does not have are listed, and block it;
//   - Progress: the client's recent workouts on the assigned routines, with their sets;
//   - End link.
// Every write names the revision it was based on; a 409 reloads and says so.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRefreshOnReturn } from './useRefreshOnReturn.js'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button, Row, Section, TextArea } from './adapter.js'
import { getAssignmentFor, saveDraft, publishDraft, getProgress, revokeLink } from './client.js'
import { diffPlans } from './diff.js'
import DiffList, { exerciseLabel } from './DiffList.jsx'
import Page, { Note } from './Page.jsx'
import { LIMITS } from './library.js'
import { LINK_TEXT as T, TEXT } from './strings.js'

const code = e => e?.data?.code || e?.code

function oneSide(x, unit) {
  if (!x) return '–'
  const parts = []
  if (x.weight != null && x.reps != null) parts.push(`${x.weight} ${unit} × ${x.reps}`)
  else if (x.reps != null) parts.push(`× ${x.reps}`)
  else if (x.weight != null) parts.push(`${x.weight} ${unit}`)
  if (x.time != null) parts.push(`${x.time} s`)
  return parts.join(', ') || '–'
}
/** One logged set as the trainer reads it: "22.5 kg × 8 @ RIR 2". */
export function setText(s, unit) {
  let body = s.sides ? T.sides(oneSide(s.sides.L, unit), oneSide(s.sides.R, unit)) : oneSide(s, unit)
  if (s.effort?.rir != null) body += ` @ ${T.rir(s.effort.rir)}`
  else if (s.effort?.rpe != null) body += ` @ ${T.rpe(s.effort.rpe)}`
  if (s.warmup) body = `${T.warmup}: ${body}`
  if (!s.done) body += ` (${T.notDone})`
  return body
}

export default function ClientDetail({ lib }) {
  const { link: linkId } = useParams()
  const nav = useNavigate()
  const [a, setA] = useState(null)              // GET /api/trainer/assignments, or false: no such link
  const [progress, setProgress] = useState(null)
  const [note, setNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [ending, setEnding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    try {
      const next = await getAssignmentFor(linkId)
      setA(next)
      setNote(next.draft?.note || '')
      return next
    } catch (e) {
      if (e?.status === 404) setA(false)
      else setMsg({ alert: TEXT.loadFailed })
      return null
    }
  }, [linkId])
  const loadProgress = useCallback(async () => {
    try { setProgress(await getProgress(linkId)) } catch { setProgress(null) }
  }, [linkId])
  useEffect(() => { load(); loadProgress() }, [load, loadProgress])
  useRefreshOnReturn(load, loadProgress)

  const current = a?.published?.length ? a.published[a.published.length - 1] : null
  const diff = useMemo(() => (a?.preview ? diffPlans(current?.snapshot || null, a.preview) : null), [a, current])
  if (a === false) return <Navigate to="/trainer" replace />
  if (!a) return <Page title="" back="/trainer" backLabel={TEXT.backToTrainer}><Note alert>{msg?.alert}</Note></Page>

  const name = a.link.client.name || a.link.client.id
  const programmes = (lib?.programmes || []).filter(p => !p.archived)
  const nameOf = id => exerciseLabel(id, [...(a.preview?.customEx || []), ...(current?.snapshot?.customEx || [])])
  const routineName = id => a.preview?.routines.find(r => r.id === id)?.name || lib?.programmes.find(p => p.id === a.draft?.programmeId)?.routines.find(r => r.id === id)?.name || id

  // A write that met a newer revision, or a changed library: reload, and say which.
  const refused = async e => {
    const c = code(e)
    if (e?.status === 409) setMsg({ alert: c === 'library-changed' ? T.libraryChanged : T.assignmentConflict })
    else if (c === 'archived-programme') setMsg({ alert: T.archivedProgramme })
    else if (c === 'unresolved') setMsg({ alert: T.unresolvedTitle })
    else setMsg({ alert: TEXT.failed })
    await load()
  }
  const draft = async (programmeId, text, base = a) => {
    const r = await saveDraft({ link: a.link.id, programmeId, note: text, baseRev: base.rev, ...(base.wid ? { baseWid: base.wid } : {}) })
    return r
  }
  const pick = async p => {
    setBusy(true)
    setMsg(null)
    setReviewing(false)
    try { await draft(p.id, note); await load() } catch (e) { await refused(e) }
    setBusy(false)
  }
  const review = async () => {
    if (!a.draft) { setMsg({ alert: T.draftNeeded }); return }
    setBusy(true)
    setMsg(null)
    try {
      if (note.trim() !== (a.draft.note || '')) { await draft(a.draft.programmeId, note); await load() }
      setReviewing(true)
    } catch (e) { await refused(e) }
    setBusy(false)
  }
  const publish = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await publishDraft({ link: a.link.id, baseRev: a.rev, ...(a.wid ? { baseWid: a.wid } : {}), libraryRev: a.libraryRev })
      setReviewing(false)
      await load()
      setMsg({ status: T.published(r.published.rev) })
    } catch (e) { setReviewing(false); await refused(e) }
    setBusy(false)
  }
  const end = async () => {
    setBusy(true)
    try { await revokeLink(a.link.id); nav('/trainer') }
    catch { setMsg({ alert: TEXT.failed }); setBusy(false) }
  }

  const unresolved = a.preview?.unresolved || []
  return <Page title={name} back="/trainer" backLabel={TEXT.backToTrainer} className="trainer-client">
    <Section>
      <Row icon="personCircle" title={T.modeTitle} value={T.modes[a.link.mode].label} />
      <Row icon="clipboard" title={T.status} value={T.statusText(current, a.applied)} />
      <Row icon="scale" title={T.bodyweight} value={a.link.shareBodyweight ? T.shared : T.notShared} />
    </Section>

    <Section title={T.assignProgramme} footer={programmes.length ? T.assignFooter : T.noProgrammes}>
      {programmes.map(p => <Row key={p.id} icon="list" title={p.name} subtitle={TEXT.routineCount(p.routines.length)}
        accessory={a.draft?.programmeId === p.id ? 'check' : 'none'} onClick={busy ? undefined : () => pick(p)} />)}
    </Section>
    <Section title={T.noteToClient}>
      <div style={{ padding: '10px 16px' }}>
        <TextArea aria-label={T.noteToClient} placeholder={T.notePlaceholder} rows={3} maxLength={LIMITS.note} value={note} onChange={e => setNote(e.target.value)} />
      </div>
    </Section>

    <Note alert>{msg?.alert}</Note>
    <Note>{msg?.status}</Note>
    {!reviewing && <div style={{ margin: '0 16px 16px' }}>
      <Button variant="primary" disabled={busy || !a.draft} onClick={review}>{T.review}</Button>
    </div>}
    {reviewing && a.preview && <Section title={T.reviewTitle(a.preview.routines[0]?.assigned?.rev ?? (current ? current.rev + 1 : 1), current?.rev)} className="trainer-review">
      <DiffList diff={diff} nameOf={nameOf} showUnused />
      {unresolved.length > 0 && <div role="alert" className="small" style={{ margin: '8px 16px', color: 'var(--red)' }}>
        <p style={{ margin: 0 }}>{T.unresolvedTitle}</p>
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{unresolved.map((u, i) => <li key={i}>{T.unresolvedSlot(routineName(u.routine), u.id)}</li>)}</ul>
      </div>}
      <div style={{ display: 'grid', gap: 8, margin: '8px 16px 12px' }}>
        <Button variant="primary" disabled={busy || unresolved.length > 0} onClick={publish}>{T.publish}</Button>
        <Button variant="tinted" disabled={busy} onClick={() => setReviewing(false)}>{T.cancel}</Button>
      </div>
    </Section>}

    <Section title={T.progress} footer={T.progressFooter}>
      {!progress?.workouts?.length && <Row icon="chartLine" title={T.noProgress} />}
      {(progress?.workouts || []).map((w, i) => <div key={w.id ?? i} className="trainer-workout" style={{ padding: '10px 16px', borderTop: i ? 'var(--hair) solid var(--sep)' : 'none' }}>
        <div className="lrow-t">{new Date(w.start ?? Date.parse(w.date)).toLocaleDateString()} · {w.routines.map(r => r.name || r.id).join(', ')}</div>
        <div className="small" style={{ color: 'var(--label-2)' }}>
          {[w.duration != null ? T.minutes(w.duration) : null, w.bodyweight != null ? T.bodyweightOn(w.bodyweight, progress.unit) : null].filter(Boolean).join(' · ')}
        </div>
        {w.note && <p className="small" style={{ margin: '4px 0' }}>“{w.note}”</p>}
        {w.exercises.map((e, j) => <div key={j} className="small" style={{ margin: '4px 0' }}>
          <strong>{e.name || exerciseLabel(e.id, [], T.ownExercise)}</strong>: {e.sets.map(s => setText(s, progress.unit)).join(', ')}
          {e.note ? <span style={{ color: 'var(--label-2)' }}> “{e.note}”</span> : null}
        </div>)}
      </div>)}
    </Section>

    <div style={{ display: 'grid', gap: 8, margin: '16px' }}>
      {!ending && <Button variant="danger" disabled={busy} onClick={() => setEnding(true)}>{T.endLink}</Button>}
      {ending && <>
        <p className="small" role="alert" style={{ margin: 0 }}>{T.endLinkTrainer(name)}</p>
        <Button variant="danger" disabled={busy} onClick={end}>{T.endLink}</Button>
        <Button variant="tinted" disabled={busy} onClick={() => setEnding(false)}>{T.cancel}</Button>
      </>}
    </div>
  </Page>
}

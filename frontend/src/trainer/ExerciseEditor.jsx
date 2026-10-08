// #/trainer/exercises/<id|new>: one library exercise. Name, body part, equipment, instructions and
// the demo; save, archive, restore. Fields this screen does not show (muscles, a link) are kept as
// the exercise has them.
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { BODYPARTS, ALL_EQUIPMENT, Button, Section, TextArea, TextField, vocabText } from './adapter.js'
import { cleanExerciseInput, LibraryError, LIMITS } from './library.js'
import { writeErrorText } from './useTrainer.js'
import DemoField from './DemoField.jsx'
import Page, { Note } from './Page.jsx'
import { TEXT, invalidText } from './strings.js'

const contentOf = e => ({ n: e.n, bp: e.bp, eq: e.eq || '', desc: e.desc || '', primaries: e.primaries || [], secondaries: e.secondaries || [], ...(e.url ? { url: e.url } : {}), media: e.media || null })
const BLANK = { n: '', bp: '', eq: '', desc: '', primaries: [], secondaries: [], media: null }

export default function ExerciseEditor({ lib, write, noteUsage }) {
  const { id } = useParams()
  const nav = useNavigate()
  const existing = id === 'new' ? null : lib.exercises.find(e => e.id === id) || null
  const [draft, setDraft] = useState(() => (existing ? contentOf(existing) : BLANK))
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  if (id !== 'new' && !existing) return <Navigate to="/trainer" replace />
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  const run = async (method, body) => {
    setBusy(true)
    setMsg(null)
    const r = await write('exercises', method, body)
    setBusy(false)
    if (r.ok) return r.item
    setMsg({ alert: writeErrorText(r) || invalidText(r.data) })
    return null
  }
  const save = async () => {
    let content
    try { content = cleanExerciseInput({ ...draft, media: draft.media || undefined }) }
    catch (e) { if (e instanceof LibraryError) { setMsg({ alert: invalidText(e) }); return } throw e }
    const item = existing
      ? await run('PUT', { id: existing.id, exercise: content })
      : await run('POST', { exercise: content })
    if (item) nav('/trainer')
  }
  const archive = async () => { if (await run('DELETE', { id: existing.id })) nav('/trainer') }
  const restore = async () => { if (await run('PUT', { id: existing.id, exercise: cleanExerciseInput({ ...contentOf(existing), media: existing.media }), archived: false })) setMsg({ status: TEXT.saved }) }

  return <Page title={existing ? TEXT.editExercise : TEXT.newExercise} back="/trainer" backLabel={TEXT.backToTrainer}>
    <Section>
      <div style={{ padding: '10px 16px' }}>
        <label htmlFor="trainer-ex-name" className="small dim">{TEXT.name}</label>
        <TextField id="trainer-ex-name" maxLength={LIMITS.name} value={draft.n} onChange={e => set('n', e.target.value)} />
      </div>
    </Section>
    <Section title={TEXT.bodyPart}>
      <div className="chips" role="group" aria-label={TEXT.bodyPart} style={{ padding: '10px 16px', flexWrap: 'wrap' }}>
        {BODYPARTS.map(b => <button key={b} type="button" className={'chip' + (draft.bp === b ? ' on' : '')} aria-pressed={draft.bp === b} onClick={() => set('bp', b)}>{vocabText(b)}</button>)}
      </div>
    </Section>
    <Section title={TEXT.equipment}>
      <div className="chips" role="group" aria-label={TEXT.equipment} style={{ padding: '10px 16px', flexWrap: 'wrap' }}>
        {ALL_EQUIPMENT.map(q => <button key={q} type="button" className={'chip' + (draft.eq === q ? ' on' : '')} aria-pressed={draft.eq === q} onClick={() => set('eq', draft.eq === q ? '' : q)}>{vocabText(q)}</button>)}
      </div>
    </Section>
    <Section title={TEXT.instructions}>
      <div style={{ padding: '10px 16px' }}>
        <TextArea aria-label={TEXT.instructions} placeholder={TEXT.instructionsHint} rows={5} maxLength={LIMITS.desc} value={draft.desc} onChange={e => set('desc', e.target.value)} />
      </div>
    </Section>
    <DemoField media={draft.media} onChange={m => set('media', m)} limits={lib.media?.limits} onUsage={noteUsage} />

    <Note alert>{msg?.alert}</Note>
    <Note>{msg?.status}</Note>
    <div style={{ display: 'grid', gap: 8, margin: '16px' }}>
      <Button variant="primary" disabled={busy} onClick={save}>{existing ? TEXT.save : TEXT.create}</Button>
      {existing && !existing.archived && <Button variant="danger" icon="trash" disabled={busy} onClick={archive}>{TEXT.archive}</Button>}
      {existing?.archived && <Button variant="tinted" disabled={busy} onClick={restore}>{TEXT.restore}</Button>}
    </div>
    {existing?.archived && <Note>{TEXT.archivedNote}</Note>}
  </Page>
}

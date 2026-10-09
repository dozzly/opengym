// "Quick session from the Coach", under "Freestyle workout" on the start screen (Workout.jsx's hook
// point, FIT-008). Nothing unless the server has the module on and the Coach available for it
// (GET /api/trainer/quick-session). Opened, it asks for today's time, focus, equipment and how the
// person feels, and sends that to the Coach; the answer is a session to start as a one-off, keep
// as a routine, ask again or discard (quick.js). An answer waits on the server for a while, so the
// person can leave the screen and come back to it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ALL_EQUIPMENT, Button, CATALOGUE, Segmented, TextArea, currentProfile, exerciseNameFor, getLang, useUser, vocabText } from './adapter.js'
import { useTrainerStatus } from './status.js'
import { askQuickSession, dropQuickSession, getQuickSession } from './client.js'
import { FEELING, FOCUS, MINUTES, loadForm, prescriptionText, saveForm, startSession } from './quick.js'
import { QUICK_TEXT as T } from './strings.js'

export const POLL_MS = 2500
const EQUIPMENT_SHOWN = 10
const NOTE_MAX = 300

function nameOf(id) {
  const own = (currentProfile()?.customEx || []).find(c => c.id === id)
  if (own) return own.n
  const ex = CATALOGUE.find(e => e.id === id)
  return ex ? exerciseNameFor(ex) : id
}

function Chips({ options, value, onPick, label, multi = false }) {
  const on = v => (multi ? value.includes(v) : value === v)
  return <div className="chips" role="group" aria-label={label} style={{ flexWrap: 'wrap', overflowX: 'visible', touchAction: 'auto' }}>
    {options.map(o => <button key={o.value} type="button" className={'chip' + (on(o.value) ? ' on' : '')} aria-pressed={on(o.value)} onClick={() => onPick(o.value)}>{o.label}</button>)}
  </div>
}

function Form({ form, setForm, onAsk, onCancel, busy }) {
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const toggleEq = v => set({ equipment: v === '' ? [] : form.equipment.includes(v) ? form.equipment.filter(x => x !== v) : [...form.equipment, v] })
  const eqOptions = [{ value: '', label: T.usual }, ...ALL_EQUIPMENT.slice(0, EQUIPMENT_SHOWN).map(e => ({ value: e, label: vocabText(e) }))]
  return <div style={{ display: 'grid', gap: 10 }}>
    <p className="small" style={{ margin: 0, color: 'var(--label-2)' }}>{T.intro}</p>
    <span className="small dim">{T.minutes}</span>
    <Segmented options={MINUTES.map(m => ({ value: m, label: T.minutesOpt(m) }))} value={form.minutes} onChange={m => set({ minutes: m })} />
    <span className="small dim">{T.focus}</span>
    <Chips label={T.focus} options={FOCUS.map(f => ({ value: f, label: T.focuses[f] }))} value={form.focus} onPick={f => set({ focus: f })} />
    <span className="small dim">{T.equipment}</span>
    <Chips label={T.equipment} multi options={eqOptions} value={form.equipment.length ? form.equipment : ['']} onPick={toggleEq} />
    <span className="small dim">{T.feeling}</span>
    <Segmented options={FEELING.map(f => ({ value: f, label: T.feelings[f] }))} value={form.feeling} onChange={f => set({ feeling: f })} />
    <TextArea aria-label={T.note} placeholder={T.noteHint} rows={2} maxLength={NOTE_MAX} value={form.note} onChange={e => set({ note: e.target.value })} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button variant="primary" icon="sparkles" disabled={busy} onClick={onAsk}>{T.ask}</Button>
      <Button variant="plain" disabled={busy} onClick={onCancel}>{T.cancel}</Button>
    </div>
  </div>
}

function Proposal({ session, onStart, onKeep, onAgain, onDiscard, busy }) {
  const r = session.routine
  return <div style={{ display: 'grid', gap: 8 }} data-testid="quick-proposal">
    <h2 style={{ margin: 0 }}>{session.name}</h2>
    {session.summary && <p className="small" style={{ margin: 0, color: 'var(--label-2)' }}>{session.summary}</p>}
    <div className="list">
      {r.ex.map((e, i) => <div key={i} className="item" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tt capitalize">{nameOf(e.id)}</div>
          <div className="ss">{prescriptionText(e)}</div>
          {e.why && <div className="small dim" style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{e.why}</div>}
        </div>
      </div>)}
    </div>
    <div style={{ display: 'grid', gap: 8 }}>
      <Button variant="primary" icon="play" disabled={busy} onClick={onStart}>{T.start}</Button>
      <Button variant="tinted" disabled={busy} onClick={onKeep}>{T.keep}</Button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="plain" disabled={busy} onClick={onAgain}>{T.again}</Button>
        <Button variant="plain" disabled={busy} onClick={onDiscard}>{T.discard}</Button>
      </div>
    </div>
  </div>
}

export default function QuickSessionStart({ pollMs = POLL_MS }) {
  const status = useTrainerStatus()
  const user = useUser()
  const nav = useNavigate()
  const [info, setInfo] = useState(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(loadForm)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  const on = !!(status?.enabled && user?.id)

  const look = useCallback(() => getQuickSession().then(a => { if (live.current) setInfo(a) }).catch(() => { if (live.current) setInfo(null) }), [])
  useEffect(() => { live.current = true; if (on) look(); return () => { live.current = false } }, [on, look])
  // While the Coach works, ask again every few seconds.
  const running = info?.job?.state === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setTimeout(look, pollMs)
    return () => clearTimeout(timer)
  }, [running, info, look, pollMs])

  if (!on || !info?.available) return null
  const job = info.job

  const ask = async () => {
    setBusy(true)
    setMsg(null)
    saveForm(form)
    try {
      const r = await askQuickSession({ minutes: form.minutes, focus: form.focus, equipment: form.equipment, feeling: form.feeling, ...(form.note.trim() ? { note: form.note.trim() } : {}), lang: getLang() })
      if (live.current) { setInfo(i => ({ ...i, job: r.job })); setOpen(false) }
    } catch (e) {
      if (live.current) setMsg(T.refused[e?.data?.code] || T.refused.other)
    }
    if (live.current) setBusy(false)
  }
  const drop = async () => { await dropQuickSession().catch(() => {}); if (live.current) setInfo(i => ({ ...i, job: null })) }
  const start = async keep => {
    setBusy(true)
    const started = await startSession(job.session, { keep })
    if (started) await drop()
    if (live.current) setBusy(false)
  }

  let body
  if (job?.state === 'ready') {
    body = <Proposal session={job.session} busy={busy} onStart={() => start(false)} onKeep={() => start(true)}
      onAgain={async () => { await drop(); setOpen(true) }} onDiscard={drop} />
  } else if (running) {
    body = <p className="small" role="status" style={{ margin: 0 }}>{T.thinking}</p>
  } else if (open && !info.consent) {
    body = <div style={{ display: 'grid', gap: 8 }}>
      <p className="small" style={{ margin: 0 }}>{T.consent}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="tinted" onClick={() => nav('/plan')}>{T.openPlan}</Button>
        <Button variant="plain" onClick={() => setOpen(false)}>{T.cancel}</Button>
      </div>
    </div>
  } else if (open) {
    body = <Form form={form} setForm={setForm} busy={busy} onAsk={ask} onCancel={() => setOpen(false)} />
  } else {
    return <div data-testid="quick-session" style={{ marginTop: 10 }}>
      {job?.state === 'failed' && <p role="alert" className="small" style={{ margin: '0 0 8px', color: 'var(--red)' }}>{T.failed[job.errorClass] || T.failed.other}</p>}
      <Button icon="sparkles" onClick={() => { setMsg(null); if (job?.state === 'failed') drop(); setOpen(true) }}>{T.open}</Button>
    </div>
  }
  return <div className="card" data-testid="quick-session" style={{ marginTop: 10 }}>
    <h2 className="accent" style={{ marginTop: 0 }}>{T.title}</h2>
    {body}
    {msg && <p role="alert" className="small" style={{ margin: '8px 0 0', color: 'var(--red)' }}>{msg}</p>}
  </div>
}

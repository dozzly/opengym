// A cardio slot's run, as steps (FIT-009): warm-up, easy, steady, tempo, fast, recovery and
// cool-down by distance or time, and repeats (times × work, with a jog, walk or rest between),
// each with an optional pace, pace range, speed or heart-rate zone. Below them, the text the client
// will read (run.js runText), with the instructions after it, and how much of upstream's 500
// characters that takes.
//
// What is typed stays as typed while it is incomplete ("4:" on the way to "4:30"): the draft keeps
// it in `_`-prefixed fields beside the numbers, and cleanRun() drops them on save.
import { Button } from './adapter.js'
import { KINDS, REST_HOW, RUN_LIMITS, cleanRun, deliveredNote, runText } from './run.js'
import { LIMITS } from './library.js'
import { RUN_TEXT as T } from './strings.js'

const clone = v => JSON.parse(JSON.stringify(v))
const newStep = () => ({ kind: 'easy', km: 5 })
const newRepeat = () => ({ kind: 'repeat', times: 5, work: { km: 1 }, rest: { sec: 90, how: 'jog' } })
// Upstream's .input is a full-width form field; a step needs four or five of them on one line of a
// phone, so these are smaller.
const compact = { padding: '7px 9px', fontSize: 15, borderRadius: 8, background: 'var(--surface-2)' }
const sel = { ...compact, width: 'auto', minWidth: 0 }
const numStyle = { ...compact, width: 58 }

/** The unit an amount is shown in: as typed, else what reads naturally. */
const unitOf = a => a._u || (a.km != null ? (a.km < 1 ? 'm' : 'km') : a.sec != null && (a.sec < 60 || a.sec % 60) ? 's' : 'min')
function shown(a, u) {
  if (a._v != null) return a._v
  if (u === 'km') return a.km ?? ''
  if (u === 'm') return a.km != null ? Math.round(a.km * 1000) : ''
  if (u === 'min') return a.sec != null ? Math.round((a.sec / 60) * 100) / 100 : ''
  return a.sec ?? ''
}
/** `a` with the value `v` (as typed) in unit `u`: km or sec set when `v` is a number, neither when not. */
function withAmount(a, v, u) {
  const out = { ...a, _v: v, _u: u }
  delete out.km
  delete out.sec
  const n = v === '' ? NaN : Number(v)
  if (Number.isFinite(n)) {
    if (u === 'km') out.km = n
    else if (u === 'm') out.km = n / 1000
    else if (u === 'min') out.sec = Math.round(n * 60)
    else out.sec = Math.round(n)
  }
  return out
}
/** "4:30" → 270; null for anything else. */
export function parsePace(s) {
  const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(String(s ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const paceShown = (raw, sec) => raw ?? (sec != null ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '')
const targetMode = t => (!t ? 'none' : t._m || (t.paceTo != null ? 'range' : t.pace != null ? 'pace' : t.kmh != null ? 'speed' : 'zone'))

const isDistance = u => u === 'km' || u === 'm'

function Amount({ value, onChange, label }) {
  const u = unitOf(value)
  // km and m (or min and s) are the same amount shown another way; a distance and a time are not.
  const unit = nu => {
    if (isDistance(nu) !== isDistance(u)) return onChange(withAmount(value, '', nu))
    const out = { ...value, _u: nu }
    delete out._v
    onChange(out)
  }
  return <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
    <input className="input" type="text" inputMode="decimal" aria-label={label} style={numStyle}
      value={shown(value, u)} onChange={e => onChange(withAmount(value, e.target.value, u))} />
    <select className="input" aria-label={T.unitFor(label)} style={sel} value={u} onChange={e => unit(e.target.value)}>
      {['km', 'm', 'min', 's'].map(x => <option key={x} value={x}>{T.units[x]}</option>)}
    </select>
  </span>
}

function Target({ value, onChange, label }) {
  const mode = targetMode(value)
  const set = m => onChange(m === 'none' ? null : m === 'zone' ? { _m: m, zone: 2 } : { _m: m })
  const pace = (k, raw) => {
    const out = { ...value, [`_${k}`]: raw }
    const sec = parsePace(raw)
    if (sec == null) delete out[k]
    else out[k] = sec
    onChange(out)
  }
  return <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
    <select className="input" aria-label={label} style={sel} value={mode} onChange={e => set(e.target.value)}>
      {['none', 'pace', 'range', 'speed', 'zone'].map(m => <option key={m} value={m}>{T.targets[m]}</option>)}
    </select>
    {(mode === 'pace' || mode === 'range') && <input className="input" type="text" inputMode="numeric" placeholder="4:30" aria-label={T.paceFor(label)}
      style={numStyle} value={paceShown(value._pace, value.pace)} onChange={e => pace('pace', e.target.value)} />}
    {mode === 'range' && <><span className="small dim">–</span><input className="input" type="text" inputMode="numeric" placeholder="4:45"
      aria-label={T.paceToFor(label)} style={numStyle} value={paceShown(value._paceTo, value.paceTo)} onChange={e => pace('paceTo', e.target.value)} /></>}
    {(mode === 'pace' || mode === 'range') && <span className="small dim">{T.perKm}</span>}
    {mode === 'speed' && <><input className="input" type="text" inputMode="decimal" aria-label={T.speedFor(label)} style={numStyle}
      value={value._kmh ?? value.kmh ?? ''} onChange={e => {
        const n = e.target.value === '' ? NaN : Number(e.target.value)
        const out = { ...value, _kmh: e.target.value }
        if (Number.isFinite(n)) out.kmh = n; else delete out.kmh
        onChange(out)
      }} /><span className="small dim">km/h</span></>}
    {mode === 'zone' && <select className="input" aria-label={T.zoneFor(label)} style={sel} value={value.zone ?? 2}
      onChange={e => onChange({ ...value, zone: Number(e.target.value) })}>
      {[1, 2, 3, 4, 5].map(z => <option key={z} value={z}>{T.zone(z)}</option>)}
    </select>}
  </span>
}

function Step({ step, n, onChange, onRemove, onUp }) {
  const label = T.step(n)
  const kind = e => {
    const k = e.target.value
    if (k === 'repeat') onChange(step.kind === 'repeat' ? step : newRepeat())
    else onChange(step.kind === 'repeat' ? { kind: k, ...(step.work.km != null ? { km: step.work.km } : { sec: step.work.sec }) } : { ...step, kind: k })
  }
  // Move up and Remove close the step's last line.
  const actions = <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 2 }}>
    {onUp && <Button size="sm" variant="ghost" onClick={onUp} aria-label={T.moveUpFor(label)}>↑</Button>}
    <Button size="sm" variant="ghost" onClick={onRemove} aria-label={T.removeFor(label)}>{T.remove}</Button>
  </span>
  const line = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }
  return <div data-run-step={n} style={{ display: 'grid', gap: 6, padding: '8px 0', borderTop: 'var(--hair) solid var(--sep)' }}>
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="small dim">{n}.</span>
      <select className="input" aria-label={label} style={sel} value={step.kind} onChange={kind}>
        {KINDS.map(k => <option key={k} value={k}>{T.kinds[k]}</option>)}
        <option value="repeat">{T.kinds.repeat}</option>
      </select>
      {step.kind === 'repeat'
        ? <><input className="input" type="text" inputMode="numeric" aria-label={T.timesFor(label)} style={{ ...compact, width: 44 }}
          value={step._times ?? step.times ?? ''} onChange={e => {
            const v = e.target.value
            const out = { ...step, _times: v }
            if (/^\d+$/.test(v)) out.times = Number(v); else delete out.times
            onChange(out)
          }} /><span className="small dim">×</span>
          <Amount label={T.workFor(label)} value={step.work} onChange={work => onChange({ ...step, work })} /></>
        : <Amount label={T.amountFor(label)} value={step} onChange={a => onChange(a)} />}
    </span>
    {step.kind === 'repeat'
      ? <>
        <Target label={T.targetFor(label)} value={step.work.target || null} onChange={t => onChange({ ...step, work: { ...step.work, ...(t ? { target: t } : { target: undefined }) } })} />
        <span style={line}>
          <select className="input" aria-label={T.recoveryFor(label)} style={sel} value={step.rest?.how || 'none'}
            onChange={e => onChange(e.target.value === 'none' ? { ...step, rest: undefined } : { ...step, rest: { sec: 90, ...step.rest, how: e.target.value } })}>
            <option value="none">{T.noRecovery}</option>
            {REST_HOW.map(h => <option key={h} value={h}>{T.rest[h]}</option>)}
          </select>
          {step.rest && <Amount label={T.recoveryAmountFor(label)} value={step.rest} onChange={rest => onChange({ ...step, rest })} />}
          {step.rest && <span className="small dim">{T.between}</span>}
          {actions}
        </span>
      </>
      : <span style={line}>
        <Target label={T.targetFor(label)} value={step.target || null} onChange={t => onChange(t ? { ...step, target: t } : (({ target: _t, ...rest }) => rest)(step))} />
        {actions}
      </span>}
  </div>
}

/** The steps of `run` (null for none yet), with `note` the trainer's own instructions. */
export default function RunEditor({ run, note, onChange, title }) {
  if (!run) return <Button size="sm" variant="tinted" onClick={() => onChange({ steps: [{ kind: 'warmup', km: 1 }, newStep(), { kind: 'cooldown', km: 1 }] })}>
    {T.add}
  </Button>
  const steps = run.steps || []
  const edit = fn => { const r = clone(run); fn(r.steps); onChange(r) }
  let text = null
  try { text = deliveredNote(cleanRun(run), (note || '').trim()) } catch { text = null }
  return <div role="group" aria-label={T.groupFor(title)} style={{ display: 'grid', gap: 4 }}>
    <span className="small dim">{T.hint}</span>
    {steps.map((s, i) => <Step key={i} n={i + 1} step={s}
      onChange={v => edit(st => { st[i] = JSON.parse(JSON.stringify(v)) })}
      onRemove={() => (steps.length === 1 ? onChange(null) : edit(st => { st.splice(i, 1) }))}
      onUp={i > 0 ? () => edit(st => { [st[i - 1], st[i]] = [st[i], st[i - 1]] }) : null} />)}
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {steps.length < RUN_LIMITS.steps && <Button size="sm" variant="tinted" onClick={() => edit(st => { st.push(newStep()) })}>{T.addStep}</Button>}
      {steps.length < RUN_LIMITS.steps && <Button size="sm" variant="tinted" onClick={() => edit(st => { st.push(newRepeat()) })}>{T.addRepeat}</Button>}
      <Button size="sm" variant="ghost" onClick={() => onChange(null)}>{T.removeAll}</Button>
    </span>
    <span className="small dim">{T.preview}</span>
    {text != null
      ? <>
        <div className="exnote" data-testid="run-preview" style={{ margin: 0 }}>{text}</div>
        <span className="small" style={{ color: text.length > LIMITS.note ? 'var(--red)' : 'var(--label-2)' }}>{T.chars(text.length, LIMITS.note)}</span>
      </>
      : <span className="small" style={{ color: 'var(--label-2)' }}>{T.incomplete}</span>}
  </div>
}

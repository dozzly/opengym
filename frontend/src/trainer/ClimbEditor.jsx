// A climbing slot's session, as steps (FIT-010, prescribe only): a warm-up, a number of problems,
// rounds of problems (4 × 4), projecting, board time and a cool-down, each with what it takes (time,
// problems, rounds, tries, rest) and an optional boulder grade or range on the session's scale (V or
// Font) and a short note. Below them, the text the client will read (climb.js climbText), with the
// trainer's instructions after it, and how much of upstream's 500 characters that takes.
//
// Numbers stay as typed while incomplete: the draft keeps them in `_`-prefixed fields beside the
// values, and cleanClimb() drops them on save.
import { Button, Segmented } from './adapter.js'
import { CLIMB_KINDS, CLIMB_LIMITS, STEP_FIELDS, cleanClimb, climbNote, convertGrade, gradesOf } from './climb.js'
import { LIMITS } from './library.js'
import { CLIMB_TEXT as T } from './strings.js'

const clone = v => JSON.parse(JSON.stringify(v))
// The same compact controls as RunEditor.jsx.
const compact = { padding: '7px 9px', fontSize: 15, borderRadius: 8, background: 'var(--surface-2)' }
const sel = { ...compact, width: 'auto', minWidth: 0 }
const line = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }

const TIME = new Set(['sec', 'restSec'])   // typed in minutes, stored in seconds
const defaultGrade = scale => (scale === 'font' ? { from: '6B' } : { from: 'V4' })
const DEFAULTS = { sec: 900, count: 10, rounds: 4 }
export const newSession = () => ({ scale: 'V', steps: [
  { kind: 'warmup', sec: 900, grade: { from: 'V0', to: 'V1' } },
  { kind: 'circuit', rounds: 4, count: 4, grade: { from: 'V2', to: 'V3' }, restSec: 240 },
  { kind: 'cooldown', sec: 600 },
] })

/** `step` as kind `kind`: the fields both kinds take are kept, a required one it lacks gets a start. */
function asKind(step, kind, scale) {
  const spec = STEP_FIELDS[kind]
  const out = { kind }
  for (const k of [...spec.req, ...spec.opt]) {
    if (step[k] != null) out[k] = step[k]
    if (step['_' + k] != null) out['_' + k] = step['_' + k]
  }
  for (const k of spec.req) if (out[k] == null) out[k] = k === 'grade' ? defaultGrade(scale) : k === 'count' && kind === 'circuit' ? 4 : DEFAULTS[k]
  return out
}

function Num({ step, k, label, onChange, width = 52 }) {
  const shown = step['_' + k] ?? (step[k] == null ? '' : TIME.has(k) ? Math.round((step[k] / 60) * 100) / 100 : step[k])
  const set = raw => {
    const out = { ...step, ['_' + k]: raw }
    const n = raw.trim() === '' ? NaN : Number(raw)
    if (TIME.has(k) ? Number.isFinite(n) && n > 0 : /^\d+$/.test(raw.trim())) out[k] = TIME.has(k) ? Math.round(n * 60) : n
    else delete out[k]
    onChange(out)
  }
  return <input className="input" type="text" inputMode={TIME.has(k) ? 'decimal' : 'numeric'} aria-label={label}
    style={{ ...compact, width }} value={shown} onChange={e => set(e.target.value)} />
}

function Grade({ value, scale, required, label, onChange }) {
  const list = gradesOf(scale)
  const from = value?.from ?? ''
  const at = list.indexOf(from)
  return <span style={line}>
    <select className="input" aria-label={label} style={sel} value={from}
      onChange={e => onChange(e.target.value ? { from: e.target.value, ...(value?.to && list.indexOf(value.to) > list.indexOf(e.target.value) ? { to: value.to } : {}) } : null)}>
      {!required && <option value="">{T.anyGrade}</option>}
      {list.map(g => <option key={g} value={g}>{g}</option>)}
    </select>
    {value && <><span className="small dim">{T.upTo}</span>
      <select className="input" aria-label={T.toFor(label)} style={sel} value={value.to ?? ''}
        onChange={e => onChange(e.target.value ? { from: value.from, to: e.target.value } : { from: value.from })}>
        <option value="">—</option>
        {list.slice(at + 1).map(g => <option key={g} value={g}>{g}</option>)}
      </select></>}
  </span>
}

function Step({ step, n, scale, onChange, onRemove, onUp }) {
  const label = T.step(n)
  const has = k => STEP_FIELDS[step.kind].req.includes(k) || STEP_FIELDS[step.kind].opt.includes(k)
  const actions = <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 2 }}>
    {onUp && <Button size="sm" variant="ghost" onClick={onUp} aria-label={T.moveUpFor(label)}>↑</Button>}
    <Button size="sm" variant="ghost" onClick={onRemove} aria-label={T.removeFor(label)}>{T.remove}</Button>
  </span>
  return <div data-climb-step={n} style={{ display: 'grid', gap: 6, padding: '8px 0', borderTop: 'var(--hair) solid var(--sep)' }}>
    <span style={line}>
      <span className="small dim">{n}.</span>
      <select className="input" aria-label={label} style={sel} value={step.kind} onChange={e => onChange(asKind(step, e.target.value, scale))}>
        {CLIMB_KINDS.map(k => <option key={k} value={k}>{T.kinds[k]}</option>)}
      </select>
      {has('rounds') && <><Num step={step} k="rounds" label={T.roundsFor(label)} onChange={onChange} width={44} /><span className="small dim">×</span></>}
      {has('count') && <><Num step={step} k="count" label={T.countFor(label)} onChange={onChange} width={48} /><span className="small dim">{T.problems}</span></>}
      {has('sec') && <><Num step={step} k="sec" label={T.minutesFor(label)} onChange={onChange} /><span className="small dim">{T.min}</span></>}
    </span>
    {has('grade') && <Grade label={T.gradeFor(label)} scale={scale} required={STEP_FIELDS[step.kind].req.includes('grade')} value={step.grade || null}
      onChange={g => onChange(g ? { ...step, grade: g } : (({ grade: _g, ...rest }) => rest)(step))} />}
    <span style={line}>
      {has('tries') && <><Num step={step} k="tries" label={T.triesFor(label)} onChange={onChange} width={44} /><span className="small dim">{T.tries}</span></>}
      {has('restSec') && <><Num step={step} k="restSec" label={T.restFor(label)} onChange={onChange} /><span className="small dim">{T.restMin}</span></>}
      <input className="input" type="text" aria-label={T.textFor(label)} placeholder={T.textHint} maxLength={CLIMB_LIMITS.text}
        style={{ ...compact, width: 'auto', flex: '1 1 140px' }} value={step.text ?? ''} onChange={e => onChange({ ...step, text: e.target.value })} />
      {actions}
    </span>
  </div>
}

/** The steps of `climb` (null for none yet), with `note` the trainer's own instructions. */
export default function ClimbEditor({ climb, note, onChange, title }) {
  if (!climb) return <Button size="sm" variant="tinted" onClick={() => onChange(newSession())}>{T.add}</Button>
  const steps = climb.steps || []
  const edit = fn => { const c = clone(climb); fn(c); onChange(c) }
  // A grade on the other scale is converted, so switching never loses a step's grade.
  const scaleTo = to => edit(c => {
    if (c.scale === to) return
    for (const s of c.steps) if (s.grade?.from) s.grade = convertGrade(s.grade, to)
    c.scale = to
  })
  let text = null
  try { text = climbNote(cleanClimb(climb), (note || '').trim()) } catch { text = null }
  return <div role="group" aria-label={T.groupFor(title)} style={{ display: 'grid', gap: 4 }}>
    <span style={line}>
      <span className="small dim">{T.scale}</span>
      <Segmented options={[{ value: 'V', label: 'V' }, { value: 'font', label: 'Font' }]} value={climb.scale} onChange={scaleTo} />
    </span>
    <span className="small dim">{T.hint}</span>
    {steps.map((s, i) => <Step key={i} n={i + 1} step={s} scale={climb.scale}
      onChange={v => edit(c => { c.steps[i] = clone(v) })}
      onRemove={() => (steps.length === 1 ? onChange(null) : edit(c => { c.steps.splice(i, 1) }))}
      onUp={i > 0 ? () => edit(c => { [c.steps[i - 1], c.steps[i]] = [c.steps[i], c.steps[i - 1]] }) : null} />)}
    <span style={line}>
      {steps.length < CLIMB_LIMITS.steps && <Button size="sm" variant="tinted" onClick={() => edit(c => { c.steps.push({ kind: 'volume', count: 10 }) })}>{T.addStep}</Button>}
      <Button size="sm" variant="ghost" onClick={() => onChange(null)}>{T.removeAll}</Button>
    </span>
    <span className="small dim">{T.preview}</span>
    {text != null
      ? <>
        <div className="exnote" data-testid="climb-preview" style={{ margin: 0 }}>{text}</div>
        <span className="small" style={{ color: text.length > LIMITS.note ? 'var(--red)' : 'var(--label-2)' }}>{T.chars(text.length, LIMITS.note)}</span>
      </>
      : <span className="small" style={{ color: 'var(--label-2)' }}>{T.incomplete}</span>}
  </div>
}

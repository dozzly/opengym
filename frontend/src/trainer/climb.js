// A climbing session planned in steps (FIT-010, prescribe only; owner's choice 2026-10-09): what
// the trainer plans, and the text the client reads. Like a run (run.js), the trainer's library
// keeps the steps on the slot (`climb`), and a published snapshot carries only the text, in the
// slot's note, which upstream's workout screen shows. Nothing is logged per problem: the client
// logs the session as the exercise it is (time, in upstream's terms).
//
//   climb  { scale: 'V' | 'font', steps: [step] }           1 to 10 steps
//   step   { kind, sec?, count?, rounds?, tries?, restSec?, grade?: { from, to? }, text? }
//
// Which fields a step takes depends on its kind (STEP_FIELDS); the others are dropped. Grades are
// boulder grades on the session's scale, stored as written; the text gives each in the other scale
// too, in brackets, so a client who climbs on the other scale reads it in theirs.
//
// api/trainer/climb.js is this file's port for the server (climb-parity.test.js). Pure.

export const CLIMB_LIMITS = Object.freeze({ steps: 10, sec: 14400, count: 100, rounds: 20, tries: 20, restSec: 1800, text: 60 })
export const SCALES = Object.freeze(['V', 'font'])
export const V_GRADES = Object.freeze(['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17'])
export const FONT_GRADES = Object.freeze(['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'])
// The Font grades each V grade spans, the usual conversion.
const V_TO_FONT = Object.freeze({
  VB: ['3', '3'], V0: ['4', '4+'], V1: ['5', '5'], V2: ['5+', '5+'], V3: ['6A', '6A+'], V4: ['6B', '6B+'], V5: ['6C', '6C+'],
  V6: ['7A', '7A'], V7: ['7A+', '7A+'], V8: ['7B', '7B+'], V9: ['7C', '7C'], V10: ['7C+', '7C+'], V11: ['8A', '8A'], V12: ['8A+', '8A+'],
  V13: ['8B', '8B'], V14: ['8B+', '8B+'], V15: ['8C', '8C'], V16: ['8C+', '8C+'], V17: ['9A', '9A'],
})
const FONT_TO_V = Object.freeze(Object.fromEntries(FONT_GRADES.map(f => [f, V_GRADES.find(v => {
  const [lo, hi] = V_TO_FONT[v]
  const i = FONT_GRADES.indexOf(f)
  return i >= FONT_GRADES.indexOf(lo) && i <= FONT_GRADES.indexOf(hi)
})])))
export const gradesOf = scale => (scale === 'font' ? FONT_GRADES : V_GRADES)

/** A grade or range on the other scale, `to` its new scale: V3–V4 → 6A–6B+, 6A → V3. */
export function convertGrade(g, to) {
  const lo = to === 'font' ? V_TO_FONT[g.from][0] : FONT_TO_V[g.from]
  const hi = to === 'font' ? V_TO_FONT[g.to ?? g.from][1] : FONT_TO_V[g.to ?? g.from]
  return lo === hi ? { from: lo } : { from: lo, to: hi }
}

// What each kind of step takes: `req` must be there, `opt` may be.
export const STEP_FIELDS = Object.freeze({
  warmup: { req: ['sec'], opt: ['grade', 'text'] },
  volume: { req: ['count'], opt: ['grade', 'restSec', 'text'] },
  circuit: { req: ['rounds', 'count'], opt: ['grade', 'restSec', 'text'] },
  project: { req: ['grade'], opt: ['sec', 'tries', 'restSec', 'text'] },
  board: { req: ['sec'], opt: ['grade', 'text'] },
  cooldown: { req: ['sec'], opt: ['text'] },
})
export const CLIMB_KINDS = Object.freeze(Object.keys(STEP_FIELDS))
const INTS = { sec: [1, CLIMB_LIMITS.sec], count: [1, CLIMB_LIMITS.count], rounds: [2, CLIMB_LIMITS.rounds], tries: [1, CLIMB_LIMITS.tries], restSec: [1, CLIMB_LIMITS.restSec] }

export class ClimbError extends Error {
  constructor(field) {
    super(`invalid: ${field}`)
    this.code = 'invalid'
    this.field = field
  }
}
const bad = field => { throw new ClimbError(field) }
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
// One line, no control characters.
const ONE_LINE = /[\u0000-\u001f\u007f]/

function grade(raw, scale, field) {
  if (!isObj(raw)) bad(field)
  const list = gradesOf(scale)
  const from = list.indexOf(raw.from)
  if (from < 0) bad(`${field}.from`)
  if (raw.to == null) return { from: raw.from }
  const to = list.indexOf(raw.to)
  if (to <= from) bad(`${field}.to`)
  return { from: raw.from, to: raw.to }
}

/** A climbing session as the library stores it; null for none. Throws ClimbError naming where. */
export function cleanClimb(raw, field = 'climb') {
  if (raw == null) return null
  if (!isObj(raw)) bad(field)
  if (!SCALES.includes(raw.scale)) bad(`${field}.scale`)
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > CLIMB_LIMITS.steps) bad(field)
  const steps = raw.steps.map((s, i) => {
    const f = `${field}.steps.${i}`
    if (!isObj(s)) bad(f)
    const spec = STEP_FIELDS[s.kind]
    if (!spec) bad(`${f}.kind`)
    const out = { kind: s.kind }
    for (const k of [...spec.req, ...spec.opt]) {
      const v = s[k]
      if (v == null || (k === 'text' && typeof v === 'string' && !v.trim())) {
        if (spec.req.includes(k)) bad(`${f}.${k}`)
        continue
      }
      if (k === 'grade') out.grade = grade(v, raw.scale, `${f}.grade`)
      else if (k === 'text') {
        if (typeof v !== 'string' || v.trim().length > CLIMB_LIMITS.text || ONE_LINE.test(v)) bad(`${f}.text`)
        out.text = v.trim()
      } else {
        const [lo, hi] = INTS[k]
        if (!Number.isInteger(v) || v < lo || v > hi) bad(`${f}.${k}`)
        out[k] = v
      }
    }
    return out
  })
  return { scale: raw.scale, steps }
}

/* ---------------------------------------------------------------- the text the client reads */

const two = n => String(n).padStart(2, '0')
const secText = sec => (sec < 60 || (sec < 120 && sec % 60) ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)}:${two(sec % 60)} min` : `${sec / 60} min`)
const span = (lo, hi) => (lo === hi ? lo : `${lo}–${hi}`)

/** A grade or a range on `scale`, with the other scale in brackets: "V3–V4 (Font 6A–6B+)",
 *  "Font 6A (V3)". */
export function gradeText(g, scale) {
  const to = g.to ?? g.from
  if (scale === 'V') {
    const other = span(V_TO_FONT[g.from][0], V_TO_FONT[to][1])
    return `${span(g.from, to)} (Font ${other})`
  }
  return `Font ${span(g.from, to)} (${span(FONT_TO_V[g.from], FONT_TO_V[to])})`
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** One step as a line: "4 × 4 problems at V2–V3 (Font 5+–6A+), 4 min rest between rounds". */
export function climbStepText(s, scale) {
  const g = s.grade ? gradeText(s.grade, scale) : ''
  const rest = what => (s.restSec ? `, ${secText(s.restSec)} rest between ${what}` : '')
  const text = s.text ? `: ${s.text}` : ''
  switch (s.kind) {
    case 'warmup': return `Warm-up ${secText(s.sec)}${g ? ` on ${g}` : ''}${text}`
    case 'volume': return `${plural(s.count, 'problem', 'problems')}${g ? ` at ${g}` : ''}${rest('problems')}${text}`
    case 'circuit': return `${s.rounds} × ${plural(s.count, 'problem', 'problems')}${g ? ` at ${g}` : ''}${rest('rounds')}${text}`
    case 'project': return `Project ${g}${s.sec ? ` for ${secText(s.sec)}` : ''}${s.tries ? `, ${plural(s.tries, 'try', 'tries')} per problem` : ''}${rest('tries')}${text}`
    case 'board': return `Board ${secText(s.sec)}${g ? ` at ${g}` : ''}${text}`
    default: return `Cool-down ${secText(s.sec)}${text}`
  }
}

/** The whole session as the client reads it: one numbered line per step. */
export function climbText(climb) {
  return climb.steps.map((s, i) => `${i + 1}. ${climbStepText(s, climb.scale)}`).join('\n')
}

/** What the client's slot says: the session's text, then the trainer's own instructions after a
 *  blank line. */
export function climbNote(climb, note) {
  if (!climb) return note || ''
  return note ? `${climbText(climb)}\n\n${note}` : climbText(climb)
}

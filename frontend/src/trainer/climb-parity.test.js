// The server's port of climb.js (api/trainer/climb.js) and the app's give the same answers: the
// server renders the text it publishes, the app the preview the trainer sees.
import { describe, expect, it } from 'vitest'
import * as app from './climb.js'
import * as server from '../../../api/trainer/climb.js'

const outcome = (m, raw) => {
  try { const c = m.cleanClimb(raw); return { climb: c, text: c && m.climbText(c), note: m.climbNote(c, 'Cue') } }
  catch (e) { return { error: e.code, field: e.field } }
}
const INPUTS = [
  { scale: 'V', steps: [{ kind: 'warmup', sec: 900, grade: { from: 'VB', to: 'V1' }, text: 'traverses' }, { kind: 'circuit', rounds: 4, count: 4, grade: { from: 'V2', to: 'V17' }, restSec: 90 }, { kind: 'project', grade: { from: 'V8' }, tries: 1 }] },
  { scale: 'font', steps: [{ kind: 'volume', count: 12, grade: { from: '3', to: '9A' }, restSec: 30 }, { kind: 'board', sec: 3599, grade: { from: '7B+' } }, { kind: 'cooldown', sec: 61 }] },
  null, 'x', { scale: 'V', steps: [null] }, { scale: 'V', steps: [{ kind: 'project', grade: { from: 'V4', to: 'V4' } }] },
  { scale: 'font', steps: [{ kind: 'volume', count: 5, grade: { from: 'V2' } }] }, { scale: 'V', steps: [{ kind: 'warmup', sec: 14401 }] },
]

describe('climb.js on the server and in the app', () => {
  it('agree on every input, the refusals included', () => {
    for (const raw of INPUTS) expect(outcome(server, raw), JSON.stringify(raw)).toEqual(outcome(app, raw))
  })
  it('have the same limits, grades, kinds, and conversions', () => {
    for (const k of ['CLIMB_LIMITS', 'SCALES', 'V_GRADES', 'FONT_GRADES', 'STEP_FIELDS', 'CLIMB_KINDS']) expect(server[k], k).toEqual(app[k])
    for (const v of app.V_GRADES) for (const to of ['font', 'V']) {
      const g = to === 'font' ? { from: v } : app.convertGrade({ from: v }, 'font')
      expect(server.convertGrade(g, to)).toEqual(app.convertGrade(g, to))
      expect(server.gradeText(g, to === 'font' ? 'V' : 'font')).toBe(app.gradeText(g, to === 'font' ? 'V' : 'font'))
    }
  })
})

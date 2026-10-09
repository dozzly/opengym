// The server's port of run.js (api/trainer/run.js) and the app's give the same answers: the server
// renders the text it publishes, the app the preview the trainer sees.
import { describe, expect, it } from 'vitest'
import * as app from './run.js'
import * as server from '../../../api/trainer/run.js'

const INTERVALS = { steps: [
  { kind: 'warmup', km: 2, target: { zone: 2 } },
  { kind: 'repeat', times: 5, work: { km: 1, target: { pace: 270 } }, rest: { sec: 90, how: 'jog' } },
  { kind: 'cooldown', km: 1 },
] }
const ZONES = { steps: [
  { kind: 'easy', sec: 1800, target: { zone: 2 } },
  { kind: 'repeat', times: 6, work: { sec: 20, target: { kmh: 18.5 } }, rest: { sec: 60, how: 'walk' } },
] }
const outcome = (m, raw) => {
  try { const r = m.cleanRun(raw); return { run: r, text: r && m.runText(r), note: m.deliveredNote(r, 'Cue') } }
  catch (e) { return { error: e.code, field: e.field } }
}
const INPUTS = [
  INTERVALS, ZONES, null,
  { steps: [{ kind: 'tempo', km: 0.4, target: { pace: 260, paceTo: 280 } }, { kind: 'repeat', times: 3, work: { km: 0.2 } }] },
  { steps: [{ kind: 'steady', sec: 3599, target: { kmh: 12.25 } }, { kind: 'recovery', km: 99.999 }, { kind: 'easy', sec: 119 }, { kind: 'easy', sec: 120 }] },
  { steps: [] }, { steps: [{ kind: 'easy' }] }, { steps: [{ kind: 'repeat', times: 51, work: { km: 1 } }] },
  { steps: [{ kind: 'easy', km: 1, target: { pace: 300, paceTo: 299 } }] }, 'run', [1], { steps: [null] },
]

describe('run.js on the server and in the app', () => {
  it('agree on every input, the refusals included', () => {
    for (const raw of INPUTS) expect(outcome(server, raw), JSON.stringify(raw)).toEqual(outcome(app, raw))
  })
  it('have the same limits and words', () => {
    expect(server.RUN_LIMITS).toEqual(app.RUN_LIMITS)
    expect(server.KINDS).toEqual(app.KINDS)
    expect(server.REST_HOW).toEqual(app.REST_HOW)
  })
})

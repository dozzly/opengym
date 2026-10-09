// FIT-009: a run planned in steps, validated and read back as the text the client sees.
import { describe, expect, it } from 'vitest'
import { cleanRun, runText, deliveredNote, kmText, secText, RunError } from './run.js'

// The two runs the roadmap names.
const INTERVALS = { steps: [
  { kind: 'warmup', km: 2, target: { zone: 2 } },
  { kind: 'repeat', times: 5, work: { km: 1, target: { pace: 270 } }, rest: { sec: 90, how: 'jog' } },
  { kind: 'cooldown', km: 1 },
] }
const ZONES = { steps: [
  { kind: 'easy', sec: 1800, target: { zone: 2 } },
  { kind: 'repeat', times: 6, work: { sec: 20, target: { kmh: 18.5 } }, rest: { sec: 60, how: 'walk' } },
] }
const fails = (raw, field) => {
  let err
  try { cleanRun(raw) } catch (e) { err = e }
  expect(err, JSON.stringify(raw)).toBeInstanceOf(RunError)
  expect(err.field).toBe(field)
}

describe('runText', () => {
  it('reads the roadmap\'s two runs the way a runner would write them', () => {
    expect(runText(cleanRun(INTERVALS))).toBe([
      'Total: 8 km + 7:30 min',
      '1. Warm-up 2 km in heart-rate zone 2',
      '2. 5 × 1 km at 4:30/km, 90 s jog between',
      '3. Cool-down 1 km',
    ].join('\n'))
    expect(runText(cleanRun(ZONES))).toBe([
      'Total: 38 min',
      '1. Easy 30 min in heart-rate zone 2',
      '2. 6 × 20 s at 18.5 km/h, 1 min walk between',
    ].join('\n'))
  })
  it('distances under a kilometre in metres, pace ranges, steps without a target or a recovery', () => {
    const r = cleanRun({ steps: [{ kind: 'tempo', km: 0.4, target: { pace: 260, paceTo: 280 } }, { kind: 'repeat', times: 3, work: { km: 0.2 } }] })
    expect(runText(r)).toBe('Total: 1 km\n1. Tempo 400 m at 4:20–4:40/km\n2. 3 × 200 m')
    expect([kmText(21.1), kmText(0.25), secText(45), secText(90), secText(150), secText(3600)]).toEqual(['21.1 km', '250 m', '45 s', '90 s', '2:30 min', '60 min'])
  })
  it('the trainer\'s own instructions follow the run after a blank line', () => {
    const r = cleanRun({ steps: [{ kind: 'easy', km: 5 }] })
    expect(deliveredNote(r, 'Flat route')).toBe('Total: 5 km\n1. Easy 5 km\n\nFlat route')
    expect(deliveredNote(r, '')).toBe('Total: 5 km\n1. Easy 5 km')
    expect(deliveredNote(null, 'Flat route')).toBe('Flat route')
  })
})

describe('cleanRun', () => {
  it('keeps only the fields it knows and rounds distances and speeds', () => {
    expect(cleanRun({ steps: [{ kind: 'easy', km: 5.004, _v: '5.004', _u: 'km', extra: 1, target: { kmh: 10.04, _m: 'speed' } }], x: 1 }))
      .toEqual({ steps: [{ kind: 'easy', km: 5, target: { kmh: 10 } }] })
    expect(cleanRun(null)).toBe(null)
  })
  it('refuses, naming where: no steps, too many, an unknown kind, both or neither amount, out of range', () => {
    fails({ steps: [] }, 'run')
    fails({ steps: Array.from({ length: 11 }, () => ({ kind: 'easy', km: 1 })) }, 'run')
    fails({ steps: [{ kind: 'sprint', km: 1 }] }, 'run.steps.0.kind')
    fails({ steps: [{ kind: 'easy' }] }, 'run.steps.0')
    fails({ steps: [{ kind: 'easy', km: 1, sec: 60 }] }, 'run.steps.0')
    fails({ steps: [{ kind: 'easy', km: 0 }] }, 'run.steps.0.km')
    fails({ steps: [{ kind: 'easy', km: 101 }] }, 'run.steps.0.km')
    fails({ steps: [{ kind: 'easy', sec: 1.5 }] }, 'run.steps.0.sec')
    fails({ steps: [{ kind: 'easy', km: 1, target: {} }] }, 'run.steps.0.target')
    fails({ steps: [{ kind: 'easy', km: 1, target: { pace: 270, zone: 2 } }] }, 'run.steps.0.target')
    fails({ steps: [{ kind: 'easy', km: 1, target: { pace: 60 } }] }, 'run.steps.0.target.pace')
    fails({ steps: [{ kind: 'easy', km: 1, target: { pace: 270, paceTo: 270 } }] }, 'run.steps.0.target.paceTo')
    fails({ steps: [{ kind: 'easy', km: 1, target: { zone: 6 } }] }, 'run.steps.0.target.zone')
    fails({ steps: [{ kind: 'easy', km: 1, target: { kmh: 0.5 } }] }, 'run.steps.0.target.kmh')
    fails({ steps: [{ kind: 'repeat', times: 1, work: { km: 1 } }] }, 'run.steps.0.times')
    fails({ steps: [{ kind: 'repeat', times: 4, work: {} }] }, 'run.steps.0.work')
    fails({ steps: [{ kind: 'repeat', times: 4, work: { km: 1 }, rest: { sec: 60, how: 'swim' } }] }, 'run.steps.0.rest')
    fails({ steps: [{ kind: 'repeat', times: 4, work: { km: 1 }, rest: { how: 'jog' } }] }, 'run.steps.0.rest')
  })
})

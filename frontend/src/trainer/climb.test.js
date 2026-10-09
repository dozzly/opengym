// FIT-010: a climbing session planned in steps (prescribe only), validated and read back as the
// text the client sees, every grade in both scales.
import { describe, expect, it } from 'vitest'
import { cleanClimb, climbText, climbNote, gradeText, convertGrade, ClimbError, V_GRADES, FONT_GRADES } from './climb.js'

const SESSION = { scale: 'V', steps: [
  { kind: 'warmup', sec: 900, grade: { from: 'V0', to: 'V1' }, text: 'traverses' },
  { kind: 'circuit', rounds: 4, count: 4, grade: { from: 'V2', to: 'V3' }, restSec: 240 },
  { kind: 'project', grade: { from: 'V5' }, sec: 1800, tries: 3, restSec: 180 },
  { kind: 'volume', count: 1, grade: { from: 'V4' } },
  { kind: 'board', sec: 1200, text: 'Moonboard 40°' },
  { kind: 'cooldown', sec: 600 },
] }
const fails = (raw, field) => {
  let err
  try { cleanClimb(raw) } catch (e) { err = e }
  expect(err, JSON.stringify(raw)).toBeInstanceOf(ClimbError)
  expect(err.field).toBe(field)
}

describe('climbText', () => {
  it('reads a session the way a climber would write it, every grade in both scales', () => {
    expect(climbText(cleanClimb(SESSION))).toBe([
      '1. Warm-up 15 min on V0–V1 (Font 4–5): traverses',
      '2. 4 × 4 problems at V2–V3 (Font 5+–6A+), 4 min rest between rounds',
      '3. Project V5 (Font 6C–6C+) for 30 min, 3 tries per problem, 3 min rest between tries',
      '4. 1 problem at V4 (Font 6B–6B+)',
      '5. Board 20 min: Moonboard 40°',
      '6. Cool-down 10 min',
    ].join('\n'))
  })
  it('on the Font scale, the V grade goes in brackets', () => {
    expect(gradeText({ from: '6A', to: '6B+' }, 'font')).toBe('Font 6A–6B+ (V3–V4)')
    expect(gradeText({ from: '6A', to: '6A+' }, 'font')).toBe('Font 6A–6A+ (V3)')
    expect(gradeText({ from: '7A+' }, 'font')).toBe('Font 7A+ (V7)')
  })
  it('every grade converts, and back', () => {
    for (const v of V_GRADES) expect(convertGrade(convertGrade({ from: v }, 'font'), 'V'), v).toEqual({ from: v })
    for (const f of FONT_GRADES) expect(FONT_GRADES.indexOf(convertGrade(convertGrade({ from: f }, 'V'), 'font').from), f).toBeLessThanOrEqual(FONT_GRADES.indexOf(f))
    expect(convertGrade({ from: 'V3', to: 'V4' }, 'font')).toEqual({ from: '6A', to: '6B+' })
    expect(convertGrade({ from: '6A', to: '6A+' }, 'V')).toEqual({ from: 'V3' })
  })
  it('the trainer\'s instructions follow after a blank line', () => {
    const c = cleanClimb({ scale: 'font', steps: [{ kind: 'volume', count: 8, grade: { from: '5+' } }] })
    expect(climbNote(c, 'Slab focus')).toBe('1. 8 problems at Font 5+ (V2)\n\nSlab focus')
    expect(climbNote(null, 'Slab focus')).toBe('Slab focus')
  })
})

describe('cleanClimb', () => {
  it('keeps what each kind takes and drops the rest', () => {
    expect(cleanClimb({ scale: 'V', x: 1, steps: [
      { kind: 'cooldown', sec: 600, grade: { from: 'V1' }, count: 3, _sec: '10', text: '  ' },
      { kind: 'warmup', sec: 300, restSec: 60, text: ' easy ' },
    ] })).toEqual({ scale: 'V', steps: [{ kind: 'cooldown', sec: 600 }, { kind: 'warmup', sec: 300, text: 'easy' }] })
    expect(cleanClimb(null)).toBe(null)
  })
  it('refuses, naming where', () => {
    fails({ scale: 'UK', steps: [{ kind: 'cooldown', sec: 60 }] }, 'climb.scale')
    fails({ scale: 'V', steps: [] }, 'climb')
    fails({ scale: 'V', steps: Array.from({ length: 11 }, () => ({ kind: 'cooldown', sec: 60 })) }, 'climb')
    fails({ scale: 'V', steps: [{ kind: 'campus' }] }, 'climb.steps.0.kind')
    fails({ scale: 'V', steps: [{ kind: 'warmup' }] }, 'climb.steps.0.sec')
    fails({ scale: 'V', steps: [{ kind: 'project' }] }, 'climb.steps.0.grade')
    fails({ scale: 'V', steps: [{ kind: 'circuit', rounds: 1, count: 4 }] }, 'climb.steps.0.rounds')
    fails({ scale: 'V', steps: [{ kind: 'volume', count: 0 }] }, 'climb.steps.0.count')
    fails({ scale: 'V', steps: [{ kind: 'volume', count: 5, grade: { from: '6A' } }] }, 'climb.steps.0.grade.from')
    fails({ scale: 'font', steps: [{ kind: 'volume', count: 5, grade: { from: '6B', to: '6A' } }] }, 'climb.steps.0.grade.to')
    fails({ scale: 'V', steps: [{ kind: 'volume', count: 5, text: 'x'.repeat(61) }] }, 'climb.steps.0.text')
    fails({ scale: 'V', steps: [{ kind: 'volume', count: 5, text: 'two\nlines' }] }, 'climb.steps.0.text')
    fails({ scale: 'V', steps: [{ kind: 'project', grade: { from: 'V5' }, restSec: 1.5 }] }, 'climb.steps.0.restSec')
  })
})

// @vitest-environment happy-dom
// FIT-008 on the start screen: "Quick session from the Coach" under "Freestyle workout". The
// module's real routes in-process (api/trainer/quick-session.js), with a fake Coach provider that
// answers at once: nothing without the module or the Coach, the go-ahead first, then ask, wait,
// see the session, and start it as a one-off (the plan untouched) or keep it as a routine.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiUpload: vi.fn(), apiBlob: vi.fn(), setRemoteAuth: vi.fn() }))

import { api } from '../lib/api.js'
import { DEF, useStore } from '../store/useStore.js'
import { QuickSessionStart } from './index.js'
import { forgetTrainerStatus } from './status.js'
import { QUICK_TEXT as T } from './strings.js'
import { currentProfile, loadSheets, navToWorkout, stopRest } from './adapter.js'
import { harness } from '../../../api/trainer/test/inproc.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const ANNA = { id: 'u_anna', name: 'Name of u_anna' }
const clone = v => JSON.parse(JSON.stringify(v))
const ANSWER = {
  coach_contract: 1, opengym_plan: 1, name: 'Pull, 30 min', summary: 'Back and biceps; legs were yesterday.', basedOn: 'your last week', week: {},
  routines: [{ id: 'r1', name: 'Pull, 30 min', emoji: 'pullup', ex: [
    { id: '0294', sets: 3, mode: 'reps', reps: 10, why: 'Squeeze the shoulder blades at the top.' },
    { id: '0685', sets: 1, mode: 'cardio', min: 10, speed: 9, why: 'Easy 10 min run to finish.' },
  ] }],
  customEx: [],
}
let root, host, srv, cleanups, where, coach, sent

function Where() { where = useLocation().pathname; return null }

function fakeCoach({ enabled = true, spawns = false, answer = ANSWER } = {}) {
  const store = { daily: null, caps: { perProfileDaily: 0, instanceDaily: 0 }, provider: 'compatible' }
  return {
    config: {
      isEnabled: () => enabled, isConnected: () => enabled, load: () => store, save: p => Object.assign(store, p),
      modelFor: () => 'm', jobEnv: () => ({}), credentialFor: () => ({ ok: true }), bindInstanceCredential() {}, logJob() {},
    },
    jobs: { status: () => ({ job: null }) },
    adapterOf: () => ({ spawns, async invoke(o) { sent.push(o); return { code: 0, text: JSON.stringify(answer) } } }),
    handleOf: () => 'h_anna',
    fetchOf: () => fetch,
  }
}
function connect({ env = {}, consent = true, coachOpts } = {}) {
  coach = fakeCoach(coachOpts)
  srv = harness({ after: fn => cleanups.push(fn) }, { env, quickDeps: coach })
  srv.writeState(ANNA.id, { ...clone(DEF), coach: consent ? { consent: { agreedAt: 1 } } : {} })
  api.mockImplementation(async (p, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined
    const r = await srv.call((opts.method || 'GET').toUpperCase(), p, { uid: useStore.getState().user?.id, body })
    if (r.status >= 400) throw Object.assign(new Error(r.body?.error || 'HTTP ' + r.status), { status: r.status, data: r.body || {} })
    return r.body
  })
}
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await act(() => new Promise(r => setTimeout(r, 0))) }
async function mount(S = { ...clone(DEF), weighIn: false }) {
  forgetTrainerStatus()
  useStore.setState({ S, user: ANNA, ready: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/workout']}>
      <Where />
      <Routes>
        <Route path="/workout" element={<QuickSessionStart pollMs={10} />} />
        <Route path="/plan" element={<div>plan</div>} />
      </Routes>
    </MemoryRouter>
  ))
  await settle()
}
const buttons = () => [...host.querySelectorAll('button')]
const button = text => buttons().find(b => b.textContent.trim() === text)
const click = async el => { expect(el, 'element to click').toBeTruthy(); await act(async () => el.click()); await settle() }
const text = () => host.textContent
async function type(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function waitFor(fn, tries = 50) {
  for (let i = 0; i < tries; i++) { if (fn()) return; await act(() => new Promise(r => setTimeout(r, 10))) }
  expect(fn(), 'waited for').toBe(true)
}

beforeEach(() => { cleanups = []; sent = []; api.mockReset(); localStorage.clear() })
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  for (const fn of cleanups) fn()
})

describe('quick session on the start screen', () => {
  it('shows nothing with the module off, or with no Coach for it', async () => {
    connect({ env: { TRAINER: '0' } })
    await mount()
    expect(host.innerHTML).toBe('')
    act(() => root.unmount()); host.remove()
    connect({ coachOpts: { enabled: false } })
    await mount()
    expect(host.innerHTML).toBe('')
    act(() => root.unmount()); host.remove()
    connect({ coachOpts: { spawns: true } })
    await mount()
    expect(host.innerHTML).toBe('')
  })

  it('without the go-ahead, says where to give it and sends nothing', async () => {
    connect({ consent: false })
    await mount()
    await click(button(T.open))
    expect(text()).toContain(T.consent)
    await click(button(T.openPlan))
    expect(where).toBe('/plan')
    expect(sent).toHaveLength(0)
  })

  it('asks with today\'s choices, waits, shows the session, and starts it as a one-off: the plan stays as it was', async () => {
    connect()
    const S = { ...clone(DEF), weighIn: false }
    await mount(S)
    const routinesBefore = clone(currentProfile().routines)
    await click(button(T.open))
    await click(button(T.minutesOpt(30)))
    await click(button(T.focuses.pull))
    await click(button('dumbbell'))
    await click(button(T.feelings.tired))
    await type(host.querySelector(`textarea[aria-label="${T.note}"]`), 'left shoulder niggly')
    await click(button(T.ask))
    const post = api.mock.calls.find(c => c[1]?.method === 'POST')
    expect(JSON.parse(post[1].body)).toMatchObject({ minutes: 30, focus: 'pull', equipment: ['dumbbell'], feeling: 'tired', note: 'left shoulder niggly' })
    await waitFor(() => !!host.querySelector('[data-testid="quick-proposal"]'))
    // What the Coach was asked: today's request, the handle, no name.
    expect(sent[0].prompt).toContain('"focus":"pull"')
    expect(sent[0].prompt).not.toContain('Name of')
    expect(text()).toContain('Pull, 30 min')
    expect(text()).toContain('3 × 10')
    expect(text()).toContain('10 min')
    expect(text()).toContain('Squeeze the shoulder blades at the top.')
    await click(button(T.start))
    // Upstream's start code is loaded when a session starts.
    await waitFor(() => !!currentProfile().active, 300)
    const a = currentProfile().active
    expect(a).toMatchObject({ name: 'Pull, 30 min', routineIds: [], bw: null })
    expect(a.entries.map(e => e.id)).toEqual(['0294', '0685'])
    expect(a.entries[0].target.note).toBe('Squeeze the shoulder blades at the top.')
    expect(currentProfile().routines).toEqual(routinesBefore)
    // The answer is used up.
    expect((await srv.call('GET', '/api/trainer/quick-session', { uid: ANNA.id })).body.job).toBe(null)
    // The choices are remembered on this device, the note is not.
    expect(JSON.parse(localStorage.getItem('opengym.quick.form'))).toMatchObject({ minutes: 30, focus: 'pull', feeling: 'tired', note: '' })
  })

  it('keeps it as a routine of their own and starts that', async () => {
    connect()
    await mount({ ...clone(DEF), weighIn: false })
    await click(button(T.open))
    await click(button(T.ask))
    await waitFor(() => !!host.querySelector('[data-testid="quick-proposal"]'))
    await click(button(T.keep))
    await waitFor(() => !!currentProfile().active, 300)
    const kept = currentProfile().routines.at(-1)
    expect(kept.name).toBe('Pull, 30 min')
    expect(kept.ex.map(e => [e.id, e.note])).toEqual([['0294', 'Squeeze the shoulder blades at the top.'], ['0685', 'Easy 10 min run to finish.']])
    expect(currentProfile().active.routineIds).toEqual([kept.id])
  })

  it('upstream\'s start is still bwSheet and startFlow, loaded on demand (contract)', async () => {
    const sheets = await loadSheets()
    expect(typeof sheets.bwSheet).toBe('function')
    expect(typeof sheets.startFlow).toBe('function')
    expect(typeof navToWorkout).toBe('function')
    expect(typeof stopRest).toBe('function')
  })

  it('an answer that cannot be used is a message and another try, not a broken session', async () => {
    connect({ coachOpts: { answer: { coach_contract: 1, routines: [] } } })
    await mount()
    await click(button(T.open))
    await click(button(T.ask))
    await waitFor(() => text().includes(T.failed.unusable))
    expect(sent).toHaveLength(2)
    await click(button(T.open))
    expect(text()).toContain(T.ask)
    expect(text()).not.toContain(T.failed.unusable)
  })
})

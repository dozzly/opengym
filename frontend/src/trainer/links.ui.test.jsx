// @vitest-environment happy-dom
// FIT-004's screens and inbox against the module's real routes in-process (api/trainer/test/
// inproc.mjs), with the clock the harness keeps: the trainer's Clients section and client screen
// (invite shown once, open invites, assign, review the diff, publish, progress, end link), the
// client's "Your trainer" (accept and its refusals, mode, body weight, end), and the inbox
// (trainer-managed apply with Undo, the co-managed card with Later, nothing mid-workout, when it
// looks). The real server and the app's sync are in acceptance.test.jsx.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiUpload: vi.fn(), apiBlob: vi.fn(), setRemoteAuth: vi.fn() }))

import { api, apiUpload, apiBlob } from '../lib/api.js'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { TrainerRoot, TrainerInbox } from './index.js'
import { forgetTrainerStatus } from './status.js'
import { requestCheck, POLL_MS } from './delivery.js'
import { setText } from './ClientDetail.jsx'
import { LINK_TEXT as T, TEXT } from './strings.js'
import { currentProfile, updateProfile, ASSIGNED } from './adapter.js'
import { harness } from '../../../api/trainer/test/inproc.mjs'
import { exerciseBody, jpeg, mp4, programmeBody, sha, videoRef } from '../../../api/trainer/test/samples.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const ANNA = { id: 'u_anna', name: 'Name of u_anna' }
const CAT = { id: 'u_cat', name: 'Name of u_cat' }
const R1 = 'tr_0000000000000001'
const clone = v => JSON.parse(JSON.stringify(v))
let root, host, srv, cleanups, where, ownFiles

function Where() { where = useLocation().pathname; return null }

/** The module's routes in-process, answering this device as whoever is signed in on it. The two
 *  upstream media routes delivery uses (POST /api/media/missing, PUT /api/media/<hash>) are a
 *  stand-in client folder here; acceptance.test.jsx runs the real ones. */
function connect(env, emails) {
  srv = harness({ after: fn => cleanups.push(fn) }, { env, ...(emails ? { emails } : {}) })
  ownFiles = new Map()
  const who = () => useStore.getState().user?.id
  const failure = r => Object.assign(new Error(r.body?.error || 'HTTP ' + r.status), { status: r.status, data: r.body || {} })
  api.mockImplementation(async (p, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined
    if (p === '/api/media/missing') return { missing: body.hashes.filter(x => !ownFiles.has(x)) }
    // The store's own sync, which acceptance.test.jsx runs against the real server.
    if (p === '/api/data') return (opts.method || 'GET') === 'GET' ? { state: null, rev: 0 } : { ok: true, rev: 1, wid: 'a'.repeat(16) }
    if (p === '/api/data/rev') return { rev: 1 }
    const r = await srv.call((opts.method || 'GET').toUpperCase(), p, { uid: who(), body })
    if (r.status >= 400) throw failure(r)
    return r.body
  })
  apiBlob.mockImplementation(async p => {
    const r = await srv.call('GET', p, { uid: who() })
    if (r.status !== 200) throw Object.assign(failure(r), { code: r.body?.code })
    return new Blob([r.bytes])
  })
  apiUpload.mockImplementation(async (p, blob) => {
    ownFiles.set(p.split('/').pop(), Buffer.from(await blob.arrayBuffer()))
    return { ok: true, existed: false }
  })
  return srv
}
async function annasLibrary() {
  await srv.on(ANNA.id)
  const video = mp4(), poster = jpeg()
  for (const [bytes, mime] of [[video, 'video/mp4'], [poster, 'image/jpeg']]) await srv.call('PUT', `/api/media/trainer?hash=${sha(bytes)}`, { uid: ANNA.id, upload: { bytes, mime } })
  let r = await srv.call('POST', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: 0, exercise: exerciseBody({ n: 'Split squat', media: videoRef(video, poster) }) } })
  const ex = r.body.exercise
  r = await srv.call('POST', '/api/trainer/library/programmes', { uid: ANNA.id, body: { baseRev: r.body.rev, programme: programmeBody('Block 1', [{ id: ex.id, sets: 3, reps: 8 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 80 }]) } })
  return { ex, prog: r.body.programme, video, poster }
}
async function linkCat(mode) {
  const code = (await srv.call('POST', '/api/trainer/invites', { uid: ANNA.id })).body.code
  return (await srv.call('POST', '/api/trainer/links/accept', { uid: CAT.id, body: { code, mode } })).body.link
}
async function publish(linkId, programmeId, note = '') {
  const a = (await srv.call('GET', `/api/trainer/assignments?link=${linkId}`, { uid: ANNA.id })).body
  const d = (await srv.call('PUT', '/api/trainer/assignments/draft', { uid: ANNA.id, body: { link: linkId, programmeId, note, baseRev: a.rev } })).body
  return (await srv.call('POST', '/api/trainer/assignments/publish', { uid: ANNA.id, body: { link: linkId, baseRev: d.rev } })).body.published
}

async function mount(user, path = '/trainer', S = clone(DEF)) {
  forgetTrainerStatus()
  useStore.setState({ S, user, ready: true, config: { media: { imageMB: 2, gifMB: 8, videoMB: 40, videoSec: 60, quotaMB: 200 } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/trainer/*" element={<TrainerRoot />} />
        <Route path="/home" element={<div className="home">home</div>} />
      </Routes>
      <TrainerInbox />
    </MemoryRouter>
  ))
  await settle()
}
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await act(() => new Promise(r => setTimeout(r, 0))) }
const buttons = () => [...host.querySelectorAll('button')]
const button = text => buttons().find(b => b.textContent.trim() === text || b.querySelector('.lrow-t')?.textContent === text)
const click = async el => { expect(el, 'element to click').toBeTruthy(); await act(async () => el.click()); await settle() }
async function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const text = () => host.textContent
const looks = async () => { await act(async () => requestCheck()); await settle() }
const assignmentCalls = () => api.mock.calls.filter(c => c[0] === '/api/trainer/assignment').length

beforeEach(() => {
  cleanups = []
  for (const m of [api, apiUpload, apiBlob]) m.mockReset()
  localStorage.clear()
  useUI.setState({ toastMsg: '', toastAction: null })
})
afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  root = null
  vi.restoreAllMocks()
  for (const fn of cleanups) fn()
})

describe('the trainer\'s Clients section', () => {
  it('invites: the code once, with a copy button and its expiry; open invites with Revoke', async () => {
    connect()
    await annasLibrary()
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount(ANNA)
    expect(text()).toContain(T.clients)
    expect(text()).toContain(T.noClients)
    await click(button(T.inviteClient))
    const code = host.querySelector('[data-testid="invite-code"]').textContent
    expect(code).toMatch(/^PT-[A-Z2-7]{12}$/)
    const inv = srv.internals.links.read().invites[0]
    expect(text()).toContain(T.codeFooter(inv.expiresAt))
    await click(button(T.copy))
    expect(writeText).toHaveBeenCalledWith(code)
    expect(text()).toContain(T.copied)
    expect(text()).toContain(T.openInvites)
    expect(text()).toContain(T.expires(inv.expiresAt))
    // Revoked from the list: gone, and the code with it.
    await click(button(T.revoke))
    expect(srv.internals.links.read().invites[0].revokedAt).toBeTruthy()
    expect(host.querySelector('[data-testid="invite-code"]')).toBeNull()
    expect(text()).not.toContain(T.openInvites)
    // A code is never shown again: a new visit lists invites without one.
    await click(button(T.inviteClient))
    act(() => root.unmount())
    host.remove()
    await mount(ANNA)
    expect(host.querySelector('[data-testid="invite-code"]')).toBeNull()
    expect(text()).toContain(T.expires(srv.internals.links.read().invites[1].expiresAt))
  })

  it('one client: assign a programme, review the diff, publish; revision 2 shows what changed; progress; end link', async () => {
    connect()
    const { ex, prog } = await annasLibrary()
    const link = await linkCat('co-managed')
    // A second programme, so there is something to pick between.
    const lib = (await srv.call('GET', '/api/trainer/library', { uid: ANNA.id })).body
    await srv.call('POST', '/api/trainer/library/programmes', { uid: ANNA.id, body: { baseRev: lib.rev, programme: programmeBody('Block 2', [{ id: '0025', catalog: 'og1', sets: 5, reps: 5 }]) } })
    await mount(ANNA)
    expect(text()).toContain(`${T.modes['co-managed'].label} · ${T.statusText(null, null)}`)
    await click(button(CAT.name))
    expect(where).toBe(`/trainer/clients/${link.id}`)
    expect(text()).toContain(T.modes['co-managed'].label)
    expect(text()).toContain(T.noProgress)
    // Nothing to publish until a programme is picked.
    expect(button(T.review).disabled).toBe(true)
    await click(button('Block 1'))
    expect(srv.internals.assignments.read(link.id).draft).toEqual({ programmeId: prog.id, note: '' })
    await type(host.querySelector(`textarea[aria-label="${T.noteToClient}"]`), 'Easy first week')
    await click(button(T.review))
    expect(srv.internals.assignments.read(link.id).draft.note).toBe('Easy first week')
    expect(text()).toContain(T.reviewTitle(1, undefined))
    expect(text()).toContain(T.newRoutine('Day 1'))
    expect(text()).toContain(T.newExercise('Split squat'))
    await click(button(T.publish))
    expect(text()).toContain(T.published(1))
    expect(srv.internals.assignments.read(link.id).published.map(p => [p.rev, p.note])).toEqual([[1, 'Easy first week']])
    expect(srv.pushes).toHaveLength(1)

    // The client applies revision 1; the trainer edits the exercise and the programme.
    await srv.call('POST', '/api/trainer/assignment/ack', { uid: CAT.id, body: { link: link.id, rev: 1, outcome: 'applied', routineIds: [R1] } })
    let l = (await srv.call('GET', '/api/trainer/library', { uid: ANNA.id })).body
    let r = await srv.call('PUT', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: l.rev, id: ex.id, exercise: exerciseBody({ n: 'Split squat', desc: 'New cues' }) } })
    await srv.call('PUT', '/api/trainer/library/programmes', { uid: ANNA.id, body: { baseRev: r.body.rev, id: prog.id, programme: programmeBody('Block 1', [{ id: ex.id, sets: 4, reps: 8 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 80 }]) } })
    // Progress: a workout on the delivered routine, as the client's sync stored it.
    srv.writeState(CAT.id, { unit: 'kg', workouts: [{ id: 'w1', d: '2027-01-16', start: srv.clock.t + 1000, end: srv.clock.t + 1000 + 40 * 60000, routineIds: [R1], note: 'Felt good', entries: [{ id: ex.id, note: 'deep', sets: [{ w: 20, r: 8, done: true, rir: 2 }, { w: 20, r: 6, done: false }] }, { id: '0043', sets: [{ w: 80, r: 5, done: true }] }] }] })
    act(() => root.unmount())
    host.remove()
    await mount(ANNA, `/trainer/clients/${link.id}`)
    expect(text()).toContain(T.statusText({ rev: 1 }, { rev: 1, outcome: 'applied' }))
    expect(text()).toContain('Split squat: 20 kg × 8 @ RIR 2, 20 kg × 6 (not done)')
    expect(text()).toContain('barbell full squat: 80 kg × 5')
    expect(text()).toContain('“Felt good”')
    expect(text()).toContain(T.minutes(2400))
    await click(button(T.review))
    expect(text()).toContain(T.reviewTitle(2, 1))
    expect(text()).toContain('Day 1: sets, reps, weight or instructions changed for Split squat')
    expect(text()).toContain(T.revisedExercise('Split squat', 1, 2))
    // Meanwhile another tab publishes: this one's publish is a conflict, reloaded and said.
    await publish(link.id, prog.id, 'from the other tab')
    await click(button(T.publish))
    expect(host.querySelector('[role="alert"]').textContent).toBe(T.assignmentConflict)
    expect(srv.internals.assignments.read(link.id).published.map(p => p.rev)).toEqual([1, 2])

    // End link: confirmed, then gone, back on the trainer page.
    await click(button(T.endLink))
    expect(text()).toContain(T.endLinkTrainer(CAT.name))
    await click(buttons().filter(b => b.textContent.trim() === T.endLink).at(-1))
    expect(where).toBe('/trainer')
    expect(srv.internals.links.read().links[0]).toMatchObject({ revokedBy: ANNA.id })
    expect(text()).toContain(T.noClients)
  })

  it('a built-in exercise the catalogue does not have blocks publishing, and is named', async () => {
    connect()
    const { prog } = await annasLibrary()
    const link = await linkCat('trainer-managed')
    const lib = (await srv.call('GET', '/api/trainer/library', { uid: ANNA.id })).body
    await srv.call('PUT', '/api/trainer/library/programmes', { uid: ANNA.id, body: { baseRev: lib.rev, id: prog.id, programme: programmeBody('Block 1', [{ id: '9999', catalog: 'og1', sets: 2 }]) } })
    await mount(ANNA, `/trainer/clients/${link.id}`)
    await click(button('Block 1'))
    await click(button(T.review))
    expect(host.querySelector('.trainer-review [role="alert"]').textContent).toContain(T.unresolvedSlot('Day 1', '9999'))
    expect(button(T.publish).disabled).toBe(true)
    expect(srv.internals.assignments.read(link.id).published).toEqual([])
  })

  it('setText: how a logged set reads', () => {
    expect(setText({ weight: 22.5, reps: 8, time: null, effort: { rpe: 8.5 }, done: true }, 'lb')).toBe('22.5 lb × 8 @ RPE 8.5')
    expect(setText({ weight: null, reps: null, time: 45, effort: null, done: true, warmup: true }, 'kg')).toBe(`${T.warmup}: 45 s`)
    expect(setText({ weight: null, reps: null, time: null, effort: null, done: true, sides: { L: { weight: 0, reps: 10, time: null }, R: { weight: 0, reps: 9, time: null } } }, 'kg')).toBe('L 0 kg × 10 / R 0 kg × 9')
  })
})

describe('the client\'s "Your trainer"', () => {
  it('unlinked: a code, the two modes in one sentence each, body weight off; refusals in words; then linked', async () => {
    connect()
    await annasLibrary()
    await mount(CAT)
    expect(text()).toContain(T.yourTrainer)
    for (const m of ['co-managed', 'trainer-managed']) expect(text()).toContain(T.modes[m].sentence)
    expect(host.querySelector(`[aria-label="${T.shareBodyweight}"]`).getAttribute('aria-checked')).toBe('false')
    expect(button(T.accept).disabled).toBe(true)
    // A trainer's switch is there too, for this user's own trainer tools, separate from all this.
    expect(host.querySelector(`[aria-label="${TEXT.enable}"]`)).toBeTruthy()
    for (const [code, key] of [['hello', 'invite-invalid'], ['PT-AAAAAAAAAAAA', 'invite-unknown']]) {
      await type(host.querySelector('#trainer-invite-code'), code)
      await click(button(T.accept))
      expect(host.querySelector('[role="alert"]').textContent).toBe(T.acceptError[key])
    }
    const code = (await srv.call('POST', '/api/trainer/invites', { uid: ANNA.id })).body.code
    await type(host.querySelector('#trainer-invite-code'), code)
    await click(button(T.accept))
    expect(text()).toContain(T.accepted(ANNA.name))
    expect(srv.internals.links.read().links[0]).toMatchObject({ client: CAT.id, mode: 'co-managed', shareBodyweight: false })
    // Linked: the trainer's name, the mode (switchable) and the body-weight switch.
    expect([...host.querySelectorAll('.lrow-v')].map(e => e.textContent)).toContain(ANNA.name)
    await click(button(T.modes['trainer-managed'].label))
    await click(host.querySelector(`[aria-label="${T.shareBodyweight}"]`))
    expect(srv.internals.links.read().links[0]).toMatchObject({ mode: 'trainer-managed', shareBodyweight: true })
    expect(host.querySelector(`[aria-label="${T.shareBodyweight}"]`).getAttribute('aria-checked')).toBe('true')
    // A second trainer's code while linked: the refusal says so.
    act(() => root.unmount())
    host.remove()
    await srv.on('u_bea')
    const bea = (await srv.call('POST', '/api/trainer/invites', { uid: 'u_bea' })).body.code
    expect((await srv.call('POST', '/api/trainer/links/accept', { uid: CAT.id, body: { code: bea, mode: 'co-managed' } })).body.code).toBe('has-trainer')
    // End link: it says the plan stays.
    await mount(CAT)
    await click(button(T.endLink))
    expect(text()).toContain(T.endLinkClient(ANNA.name))
    await click(buttons().filter(b => b.textContent.trim() === T.endLink).at(-1))
    expect(text()).toContain(T.ended)
    expect(srv.internals.links.read().links[0]).toMatchObject({ revokedBy: CAT.id })
    expect(host.querySelector('#trainer-invite-code')).toBeTruthy()
  })
})

describe('"Your trainer" for someone with trainer tools on', () => {
  it('is folded into one "Have a code from a trainer?" row, which opens the form', async () => {
    connect()
    await annasLibrary()   // Anna's tools are on
    await mount(ANNA)
    expect(text()).toContain(T.haveCode)
    expect(host.querySelector('#trainer-invite-code')).toBeNull()
    expect(text()).not.toContain(T.unlinkedFooter)
    await click(buttons().find(b => b.textContent.includes(T.haveCode)) || [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(T.haveCode)))
    expect(host.querySelector('#trainer-invite-code')).toBeTruthy()
    expect(text()).toContain(T.unlinkedFooter)
  })
  it('stays open, as before, for someone without trainer tools', async () => {
    connect()
    await annasLibrary()
    await mount(CAT)
    expect(host.querySelector('#trainer-invite-code')).toBeTruthy()
    expect(text()).not.toContain(T.haveCode)
  })
})

describe('sign-in e-mails (PASSWORD_LOGIN on)', () => {
  const PW = { PASSWORD_LOGIN: '1' }
  it('without one, the trainer cannot invite and the client cannot accept, and each is told how to add it', async () => {
    connect(PW, { [ANNA.id]: 'anna@example.test' })
    await annasLibrary()
    const code = (await srv.call('POST', '/api/trainer/invites', { uid: ANNA.id })).body.code
    await mount(CAT)
    await type(host.querySelector('#trainer-invite-code'), code)
    await click(button(T.accept))
    expect(host.querySelector('[role="alert"]').textContent).toBe(T.acceptError['email-required'])
    expect(srv.internals.links.read().links).toHaveLength(0)
    act(() => root.unmount()); host.remove()
    connect(PW)
    await annasLibrary()
    await mount(ANNA)
    await click(button(T.inviteClient))
    expect(text()).toContain(T.inviteEmailRequired)
    expect(host.querySelector('[data-testid="invite-code"]')).toBeNull()
  })
  it('with them, the trainer sees the client\'s e-mail beside her name, and the client the trainer\'s', async () => {
    connect(PW, { [ANNA.id]: 'anna@example.test', [CAT.id]: 'cat@example.test' })
    await annasLibrary()
    await linkCat('co-managed')
    await mount(ANNA)
    expect(text()).toContain('cat@example.test')
    act(() => root.unmount()); host.remove()
    await mount(CAT)
    expect(text()).toContain(ANNA.name)
    expect(text()).toContain('anna@example.test')
  })
})

describe('the inbox', () => {
  const mine = () => ({ ...clone(DEF), routines: [{ id: 'r_mine', name: 'Mine', ex: [] }], bodyweight: [{ d: '2026-10-01', w: 60, t: 1 }], workouts: [{ id: 'w0', d: '2026-10-01', routineIds: ['r_mine'], entries: [] }] })

  it('trainer-managed: applied on its own, demos copied, a toast with Undo; Undo puts the plan back and says so to the trainer', async () => {
    connect()
    const { prog, video, poster } = await annasLibrary()
    const link = await linkCat('trainer-managed')
    await publish(link.id, prog.id)
    await mount(CAT, '/home', mine())
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine', R1])
    expect(routine1()[ASSIGNED]).toEqual({ by: ANNA.id, assignmentId: link.id, rev: 1 })
    expect([...ownFiles.keys()].sort()).toEqual([sha(video), sha(poster)].sort())
    expect(srv.internals.assignments.read(link.id).applied).toMatchObject({ rev: 1, outcome: 'applied', routineIds: [R1] })
    expect(useUI.getState().toastMsg).toBe(T.applied(ANNA.name))
    await act(async () => useUI.getState().runToastAction())
    await settle()
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine'])
    expect(currentProfile().workouts).toEqual(mine().workouts)
    expect(useUI.getState().toastMsg).toBe(T.undone)
    expect(srv.internals.assignments.read(link.id).applied).toMatchObject({ rev: 1, outcome: 'discarded', routineIds: [] })
    // Undone stays undone: the next look applies nothing until the trainer publishes again.
    await looks()
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine'])
    await publish(link.id, prog.id)
    await looks()
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine', R1])
    // Demo files the client already has are not fetched again.
    expect(apiBlob).toHaveBeenCalledTimes(2)
  })
  const routine1 = () => currentProfile().routines.find(r => r.id === R1)

  it('not under a running workout: it waits for the workout to end', async () => {
    connect()
    const { prog } = await annasLibrary()
    const link = await linkCat('trainer-managed')
    await publish(link.id, prog.id)
    await mount(CAT, '/home', { ...mine(), active: { id: 'a1', routineIds: ['r_mine'], entries: [] } })
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine'])
    await act(async () => updateProfile(s => { s.active = null }))
    await settle()
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine', R1])
  })

  it('co-managed: a card with the note and the diff; Later hides it until the next revision; nothing is applied unasked', async () => {
    connect()
    const { prog } = await annasLibrary()
    const link = await linkCat('co-managed')
    await publish(link.id, prog.id, 'Easy week')
    await mount(CAT, '/home', mine())
    const card = host.querySelector('.trainer-update')
    expect(card.getAttribute('aria-label')).toBe(T.updateTitle(ANNA.name))
    expect(card.textContent).toContain('“Easy week”')
    expect(card.textContent).toContain(T.newRoutine('Day 1'))
    expect(card.textContent).toContain(T.newExercise('Split squat'))
    expect(card.textContent).toContain(T.updateFooter)
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine'])
    await click(button(T.later))
    expect(host.querySelector('.trainer-update')).toBeNull()
    await looks()
    expect(host.querySelector('.trainer-update')).toBeNull()
    expect(srv.internals.assignments.read(link.id).applied).toBe(null)
    await publish(link.id, prog.id, 'Easy week, again')
    await looks()
    expect(host.querySelector('.trainer-update').textContent).toContain('Easy week, again')
    // Not shown over a running workout.
    await act(async () => updateProfile(s => { s.active = { id: 'a1', entries: [] } }))
    await settle()
    expect(host.querySelector('.trainer-update')).toBeNull()
  })

  it('a look asked for while one is in flight runs after it: an update published meanwhile is not missed', async () => {
    connect()
    const { prog } = await annasLibrary()
    const link = await linkCat('co-managed')
    await mount(CAT, '/home', mine())
    const real = api.getMockImplementation()
    let release = null
    // The next answer is read now (nothing published yet) and handed over only later.
    api.mockImplementation(async (p, o) => {
      const r = await real(p, o)
      if (p === '/api/trainer/assignment' && release === null) await new Promise(res => { release = res })
      return r
    })
    act(() => requestCheck())
    await settle()
    await publish(link.id, prog.id, 'Meanwhile')
    act(() => requestCheck())
    await act(async () => release())
    await settle()
    expect(host.querySelector('.trainer-update')?.textContent).toContain('Meanwhile')
  })

  it('starts once the store\'s first pull is done', async () => {
    connect()
    const { prog } = await annasLibrary()
    const link = await linkCat('trainer-managed')
    await publish(link.id, prog.id)
    forgetTrainerStatus()
    useStore.setState({ S: mine(), user: CAT, ready: false })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(<MemoryRouter><TrainerInbox /></MemoryRouter>))
    await settle()
    expect(assignmentCalls()).toBe(0)
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine'])
    await act(async () => useStore.setState({ ready: true }))
    await settle()
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_mine', R1])
  })

  it('looks on start, on focus, when the page becomes visible and every 60 seconds; not at all with the module off or signed out', async () => {
    connect()
    await annasLibrary()
    await linkCat('co-managed')
    const every = vi.spyOn(window, 'setInterval')
    await mount(CAT, '/home', mine())
    expect(assignmentCalls()).toBe(1)
    await act(async () => window.dispatchEvent(new Event('focus')))
    await settle()
    expect(assignmentCalls()).toBe(2)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await settle()
    expect(assignmentCalls()).toBe(3)
    // The inbox's timer is the last one at POLL_MS (the proxy-session keeper, mounted beside it, has its own).
    const tick = every.mock.calls.filter(c => c[1] === POLL_MS).at(-1)
    expect(POLL_MS).toBe(60000)
    expect(tick).toBeTruthy()
    await act(async () => tick[0]())
    await settle()
    expect(assignmentCalls()).toBe(4)
    act(() => root.unmount())
    host.remove()
    // Signed out: nothing. Module off (404): the status once, then nothing.
    api.mockClear()
    await mount(null, '/home')
    expect(api).not.toHaveBeenCalled()
    act(() => root.unmount())
    host.remove()
    api.mockReset()
    api.mockRejectedValue(Object.assign(new Error('not found'), { status: 404, data: { error: 'not found' } }))
    await mount(CAT, '/home')
    await act(async () => window.dispatchEvent(new Event('focus')))
    await settle()
    expect(api.mock.calls.map(c => c[0])).toEqual(['/api/trainer/status'])
  })
})

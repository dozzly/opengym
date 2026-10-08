// @vitest-environment happy-dom
// FIT-004 acceptance, on the real server: api/server.js with TRAINER=1 in a child process, in a
// data directory of its own, with synthetic users. The client's side is this app: its store, its
// sync (pushState → PUT /api/data, with its revision), the module's inbox and screens, and
// upstream's media upload. The app's transports (lib/api.js api, apiUpload, apiBlob) are pointed at
// that server with the signed-in user's session; everything behind them is the real thing. The
// trainer's side is driven through the module's HTTP routes, which TrainerRoot/links.ui tests
// exercise through the trainer's screens.
//
// The roadmap's MVP flow, steps 1-7, and its invariants:
//   1. A trainer creates a one-time invitation.
//   2. The client accepts it in the app as trainer-managed.
//   3. The trainer publishes a programme whose library exercise has a demo video.
//   4. The client's app applies it on its own, copies the demo into the client's own media, syncs.
//   5. The client finishes a workout on an assigned routine; the app syncs it (PUT /api/data).
//   6. The trainer's progress view shows its sets.
//   7. The trainer publishes revision 2; the app re-applies it with history intact.
// plus a second client reusing the same exercise and demo (co-managed: Discard, then Apply), the
// operator never readable, a stale publish, and revocation from either side.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiUpload: vi.fn(), apiBlob: vi.fn(), setRemoteAuth: vi.fn() }))

import { api, apiUpload, apiBlob } from '../lib/api.js'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { buildSessionEntries } from '../lib/session-start.js'
import { buildCompletedWorkout } from '../lib/finish-workout.js'
import { TrainerRoot, TrainerInbox } from './index.js'
import { forgetTrainerStatus } from './status.js'
import { requestCheck } from './delivery.js'
import { LINK_TEXT as T } from './strings.js'
import { currentProfile, updateProfile, ASSIGNED } from './adapter.js'
import { startServer } from '../../../api/trainer/test/helpers.mjs'
import { exerciseBody, jpeg, mp4, programmeBody, sha, videoRef } from '../../../api/trainer/test/samples.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const ANNA = { id: 'u_anna', name: 'Anna Trainer' }
const CAT = { id: 'u_cat', name: 'Cat Client' }
const DAN = { id: 'u_dan', name: 'Dan Second' }
const OP = { id: 'u_op', name: 'The Operator' }
const clone = v => JSON.parse(JSON.stringify(v))
let cleanups, root, host, h

/** server.js, on, with the four synthetic users. */
async function boot(env = { TRAINER: '1' }) {
  h = await startServer({ after: fn => cleanups.push(fn) }, { env: { MEDIA_MIN_FREE_MB: '0', ...env }, users: [ANNA, CAT, DAN, OP] })
  // This device's transports, to that server, as whoever is signed in on it: what lib/api.js does
  // with the session cookie. Errors carry what the real ones carry ({ status, data }, and `code`
  // for the media transports).
  const who = () => useStore.getState().user?.id
  const failure = r => Object.assign(new Error(r.body?.error || 'HTTP ' + r.status), { status: r.status, data: r.body || {} })
  api.mockImplementation(async (p, opts = {}) => {
    const r = await h.http((opts.method || 'GET').toUpperCase(), p, { uid: who(), body: opts.body ? JSON.parse(opts.body) : undefined })
    if (r.status >= 400) throw failure(r)
    return r.body
  })
  apiBlob.mockImplementation(async (p, { expectSize } = {}) => {
    const r = await h.http('GET', p, { uid: who() })
    if (r.status !== 200) throw Object.assign(failure(r), { code: r.body?.code || 'http' })
    if (expectSize != null && r.bytes.length > expectSize + 1024) throw Object.assign(new Error('too large'), { code: 'too-large' })
    return new Blob([r.bytes])
  })
  apiUpload.mockImplementation(async (p, blob, mime) => {
    const r = await h.http('PUT', p, { uid: who(), bytes: Buffer.from(await blob.arrayBuffer()), mime })
    if (r.status >= 400) throw Object.assign(failure(r), { code: r.body?.code || 'http' })
    return r.body
  })
  return h
}
const ok = (r, status = 200) => { expect(r.status, JSON.stringify(r.body)).toBe(status); return r.body }

/** The trainer's library: a demo video with its poster, one exercise using it, one programme. */
async function trainerLibrary() {
  ok(await h.http('POST', '/api/trainer/capability', { uid: ANNA.id, body: { enabled: true } }))
  const video = mp4({ seconds: 6, bytes: 4000 }), poster = jpeg(900)
  for (const [bytes, mime] of [[video, 'video/mp4'], [poster, 'image/jpeg']]) ok(await h.http('PUT', `/api/media/trainer?hash=${sha(bytes)}`, { uid: ANNA.id, bytes, mime }), 201)
  let r = ok(await h.http('POST', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: 0, exercise: exerciseBody({ media: videoRef(video, poster) }) } }), 201)
  const ex = r.exercise
  r = ok(await h.http('POST', '/api/trainer/library/programmes', { uid: ANNA.id, body: { baseRev: r.rev, programme: programmeBody('Block 1', [{ id: ex.id, sets: 3, reps: 8, weight: 20 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 80 }]) } }), 201)
  return { video, poster, ex, prog: r.programme }
}
async function newInvite() { return ok(await h.http('POST', '/api/trainer/invites', { uid: ANNA.id }), 201).code }
async function publish(linkId, programmeId, note = '') {
  const a = ok(await h.http('GET', `/api/trainer/assignments?link=${linkId}`, { uid: ANNA.id }))
  const d = ok(await h.http('PUT', '/api/trainer/assignments/draft', { uid: ANNA.id, body: { link: linkId, programmeId, note, baseRev: a.rev, baseWid: a.wid } }))
  return ok(await h.http('POST', '/api/trainer/assignments/publish', { uid: ANNA.id, body: { link: linkId, baseRev: d.rev, baseWid: d.wid } })).published
}

/** This device, signed in as `user`, holding `S`. */
function signIn(user, S = clone(DEF)) {
  localStorage.clear()
  forgetTrainerStatus()
  useStore.setState({ S, user, ready: true, config: { media: { imageMB: 2, gifMB: 8, videoMB: 40, videoSec: 60, quotaMB: 200 } } })
}
async function mount(path = '/trainer') {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/trainer/*" element={<TrainerRoot />} />
        <Route path="/home" element={<div className="home">home</div>} />
      </Routes>
      <TrainerInbox />
    </MemoryRouter>
  ))
  await settle()
}
function unmount() { if (root) act(() => root.unmount()); host?.remove(); root = null; host = null }
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await act(() => new Promise(r => setTimeout(r, 2))) }
/** What the inbox does on focus, on becoming visible and every 60 s: look now. */
const inboxLooks = async () => { await act(async () => requestCheck()); await settle() }
const buttons = () => [...host.querySelectorAll('button')]
const button = text => buttons().find(b => b.textContent.trim() === text || b.querySelector('.lrow-t')?.textContent === text)
const click = async el => { expect(el, 'element to click').toBeTruthy(); await act(async () => el.click()); await settle() }
async function type(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const sync = () => act(() => useStore.getState().pushState())
const serverState = async uid => ok(await h.http('GET', '/api/data', { uid })).state
const routine = (S, id) => S.routines.find(r => r.id === id)

/** The client finishes a workout on routine `rid`, as the app does: entries built by upstream's
 *  session builder, every set done, the finished workout by upstream's buildCompletedWorkout. */
function finishWorkout(rid, { note, rir } = {}) {
  const S = currentProfile()
  const r = routine(S, rid)
  const start = Date.now()
  const entries = buildSessionEntries(S, r).map(e => ({ ...e, sets: e.sets.map((s, i) => ({ ...s, done: true, at: start + i * 1000, ...(rir != null ? { rir } : {}) })) }))
  const active = { id: 'w_' + start, d: new Date(start).toISOString().slice(0, 10), start, routineIds: [rid], routineId: rid, name: r.name, entries, ...(note ? { note } : {}) }
  const w = buildCompletedWorkout(active, { end: start + 45 * 60000 })
  updateProfile(s => { s.workouts = [...(s.workouts || []), w]; s.active = null })
  return w
}

beforeEach(() => {
  cleanups = []
  for (const m of [api, apiUpload, apiBlob]) m.mockReset()
  useUI.setState({ toastMsg: '', toastAction: null })
})
afterEach(() => {
  unmount()
  for (const fn of cleanups) fn()
})

describe('FIT-004 acceptance on the real server', () => {
  it('the MVP flow: invite, accept trainer-managed, publish with a demo, apply and copy, train, progress, revision 2 with history intact', async () => {
    await boot()
    // The operator: self-managed, with data of their own, synced by their own device.
    const opState = { ...clone(DEF), routines: [{ id: 'r_op', name: 'Operator day', ex: [{ id: '0025', sets: 3, reps: 5 }] }], bodyweight: [{ d: '2026-10-08', w: 82 }] }
    ok(await h.http('PUT', '/api/data', { uid: OP.id, body: { state: opState, baseRev: 0, stamped: true } }))
    const opBefore = await serverState(OP.id)

    // 1. Anna enables trainer tools and creates a one-time invitation.
    const { video, poster, ex, prog } = await trainerLibrary()
    const code = await newInvite()

    // 2. Cat, who already trains on her own, accepts it in the app as trainer-managed.
    signIn(CAT, { ...clone(DEF), routines: [{ id: 'r_mine', name: 'My push day', ex: [{ id: '0025', sets: 3, reps: 8, weight: 40 }] }], bodyweight: [{ d: '2026-10-01', w: 61.2, t: 1 }], restSec: 120 })
    await sync()
    await mount()
    await type(host.querySelector('#trainer-invite-code'), code)
    await click(button(T.modes['trainer-managed'].label))
    await click(button(T.accept))
    expect(host.textContent).toContain(T.accepted(ANNA.name))
    const link = ok(await h.http('GET', '/api/trainer/links', { uid: CAT.id })).asClient
    expect([link.mode, link.shareBodyweight, link.trainer.name]).toEqual(['trainer-managed', false, ANNA.name])
    // The same code a second time, and Anna's own: refused.
    expect(ok(await h.http('POST', '/api/trainer/links/accept', { uid: DAN.id, body: { code, mode: 'co-managed' } }), 410).code).toBe('invite-used')

    // 3. Anna publishes Block 1.
    const p1 = await publish(link.id, prog.id, 'Week one: easy.')
    expect(p1.rev).toBe(1)
    // A stale publish (another tab still on the old revision): 409.
    expect(ok(await h.http('POST', '/api/trainer/assignments/publish', { uid: ANNA.id, body: { link: link.id, baseRev: 0 } }), 409).code).toBe('conflict')

    // 4. Cat's app picks it up and applies it on its own, with an Undo on the toast.
    await inboxLooks()
    expect(useUI.getState().toastMsg).toBe(T.applied(ANNA.name))
    expect(useUI.getState().toastAction?.label).toBe(T.undo)
    let S = currentProfile()
    const R1 = p1.snapshot.routines[0].id
    expect(S.routines.map(r => r.id)).toEqual(['r_mine', R1])
    expect(routine(S, R1)[ASSIGNED]).toEqual({ by: ANNA.id, assignmentId: link.id, rev: 1 })
    expect(routine(S, R1).ex).toEqual([{ id: ex.id, sets: 3, reps: 8, weight: 20 }, { id: '0043', sets: 3, reps: 5, weight: 80 }])
    expect(S.customEx.find(c => c.id === ex.id)).toMatchObject({ n: ex.n, custom: true, src: { trainer: ANNA.id, exRev: 1 }, media: { hash: sha(video) } })
    expect(routine(S, 'r_mine')).toMatchObject({ name: 'My push day' })
    expect(S.restSec).toBe(120)
    // The demo and its poster are now Cat's own files, through upstream's upload.
    for (const bytes of [video, poster]) {
      const own = await h.http('GET', `/api/media/${sha(bytes)}`, { uid: CAT.id })
      expect(own.status).toBe(200)
      expect(Buffer.compare(own.bytes, bytes)).toBe(0)
    }
    // Acknowledged, and synced by the app's own push: the server holds what the app holds.
    expect(ok(await h.http('GET', `/api/trainer/assignments?link=${link.id}`, { uid: ANNA.id })).applied).toMatchObject({ rev: 1, outcome: 'applied', routineIds: [R1] })
    await sync()
    expect((await serverState(CAT.id)).routines.map(r => r.id)).toEqual(['r_mine', R1])
    // Looking again changes nothing.
    useUI.setState({ toastMsg: '', toastAction: null })
    await inboxLooks()
    expect(useUI.getState().toastMsg).toBe('')

    // 5. Cat trains the assigned routine, and a personal one; the app syncs both.
    const w1 = finishWorkout(R1, { note: 'Felt good', rir: 2 })
    finishWorkout('r_mine')
    await sync()
    expect((await serverState(CAT.id)).workouts).toHaveLength(2)

    // 6. Anna sees the assigned workout's sets, and nothing of the personal one.
    let prog1 = ok(await h.http('GET', `/api/trainer/progress?link=${link.id}`, { uid: ANNA.id }))
    expect(prog1.workouts.map(w => w.id)).toEqual([w1.id])
    expect(prog1.workouts[0]).toMatchObject({ duration: 45 * 60, note: 'Felt good', routines: [{ id: R1, name: 'Day 1' }] })
    expect(prog1.workouts[0].exercises.map(e => [e.id, e.name, e.sets.length])).toEqual([[ex.id, ex.n, 3], ['0043', null, 3]])
    expect(prog1.workouts[0].exercises[0].sets[0]).toEqual({ weight: 20, reps: 8, time: null, effort: { rir: 2 }, done: true })
    expect(JSON.stringify(prog1)).not.toContain('My push day')
    expect('bodyweight' in prog1).toBe(false)

    // 7. Anna revises the exercise and the programme, and publishes revision 2.
    let lib = ok(await h.http('GET', '/api/trainer/library', { uid: ANNA.id }))
    let r = ok(await h.http('PUT', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: lib.rev, id: ex.id, exercise: exerciseBody({ media: videoRef(video, poster), desc: 'Torso upright.' }) } }))
    r = ok(await h.http('PUT', '/api/trainer/library/programmes', { uid: ANNA.id, body: { baseRev: r.rev, id: prog.id, programme: programmeBody('Block 1', [{ id: ex.id, sets: 4, reps: 6, weight: 22.5 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5, weight: 85 }]) } }))
    const p2 = await publish(link.id, prog.id)
    expect(p2.rev).toBe(2)
    await inboxLooks()
    S = currentProfile()
    expect(S.routines.map(r => r.id)).toEqual(['r_mine', R1])
    expect(routine(S, R1)).toMatchObject({ [ASSIGNED]: { rev: 2 }, ex: [{ id: ex.id, sets: 4, reps: 6, weight: 22.5 }, { id: '0043', sets: 3, reps: 5, weight: 85 }] })
    expect(S.customEx.find(c => c.id === ex.id)).toMatchObject({ desc: 'Torso upright.', src: { exRev: 2 } })
    // History intact: the workout still names the same routine, which still exists.
    expect(S.workouts.find(w => w.id === w1.id).routineId).toBe(R1)
    await sync()
    const after = await serverState(CAT.id)
    expect(after.workouts.map(w => w.id)).toContain(w1.id)
    expect(routine(after, R1)[ASSIGNED].rev).toBe(2)
    prog1 = ok(await h.http('GET', `/api/trainer/progress?link=${link.id}`, { uid: ANNA.id }))
    expect(prog1.workouts.map(w => w.id)).toEqual([w1.id])
    expect(ok(await h.http('GET', `/api/trainer/assignments?link=${link.id}`, { uid: ANNA.id })).applied).toMatchObject({ rev: 2, outcome: 'applied' })

    // The operator, all along: nothing of theirs changed, nothing of theirs readable.
    expect(await serverState(OP.id)).toEqual(opBefore)
    for (const q of [OP.id, 'lk_' + '0'.repeat(16)]) {
      expect((await h.http('GET', `/api/trainer/progress?link=${q}`, { uid: ANNA.id })).status).toBe(404)
      expect((await h.http('POST', '/api/trainer/assignments/publish', { uid: ANNA.id, body: { link: q, baseRev: 0 } })).status).toBe(404)
    }
  }, 60000)

  it('a second client reuses the same exercise and demo, co-managed: Discard changes nothing, Apply copies; neither client sees the other', async () => {
    await boot()
    const { video, ex, prog } = await trainerLibrary()
    // Cat, linked trainer-managed, with a plan and a workout of her own.
    const catLink = ok(await h.http('POST', '/api/trainer/links/accept', { uid: CAT.id, body: { code: await newInvite(), mode: 'trainer-managed' } }), 201).link
    ok(await h.http('PUT', '/api/data', { uid: CAT.id, body: { state: { ...clone(DEF), workouts: [{ id: 'w_cat', d: '2026-10-08', start: Date.now(), routineIds: ['tr_0000000000000001'], entries: [] }] }, baseRev: 0, stamped: true } }))
    await publish(catLink.id, prog.id)

    // Dan accepts co-managed and shares his body weight.
    signIn(DAN, { ...clone(DEF), routines: [{ id: 'r_dan', name: 'Dan\'s own', ex: [] }], bodyweight: [{ d: '2026-10-09', w: 75, t: 1 }] })
    await sync()
    const danBefore = clone(currentProfile())
    await mount()
    await type(host.querySelector('#trainer-invite-code'), await newInvite())
    await click(host.querySelector(`[aria-label="${T.shareBodyweight}"]`))
    await click(button(T.accept))
    const danLink = ok(await h.http('GET', '/api/trainer/links', { uid: DAN.id })).asClient
    expect([danLink.mode, danLink.shareBodyweight]).toEqual(['co-managed', true])

    // The same programme, the same exercise and demo, published to Dan: no second copy authored.
    const p1 = await publish(danLink.id, prog.id, 'For Dan')
    expect(p1.snapshot.customEx.map(c => c.id)).toEqual([ex.id])
    expect(ok(await h.http('GET', '/api/trainer/library', { uid: ANNA.id })).exercises).toHaveLength(1)

    // Co-managed: a card with the note and what would change. Discard changes nothing.
    await inboxLooks()
    const card = host.querySelector('.trainer-update')
    expect(card.textContent).toContain(T.updateTitle(ANNA.name))
    expect(card.textContent).toContain('For Dan')
    expect(card.textContent).toContain(T.newRoutine('Day 1'))
    await click([...card.querySelectorAll('button')].find(b => b.textContent === T.discard))
    expect(host.querySelector('.trainer-update')).toBeNull()
    const kept = clone(currentProfile())
    expect(kept.routines).toEqual(danBefore.routines)
    expect(kept.customEx).toEqual(danBefore.customEx)
    expect(kept.bodyweight).toEqual(danBefore.bodyweight)
    expect(ok(await h.http('GET', `/api/trainer/assignments?link=${danLink.id}`, { uid: ANNA.id })).applied).toMatchObject({ rev: 1, outcome: 'discarded', routineIds: [] })
    expect((await h.http('GET', `/api/media/${sha(video)}`, { uid: DAN.id })).status).toBe(404)
    // Discarded stays discarded: the next look offers nothing.
    await inboxLooks()
    expect(host.querySelector('.trainer-update')).toBeNull()

    // A new revision: Apply this time.
    await publish(danLink.id, prog.id, 'Second try')
    await inboxLooks()
    await click(button(T.apply))
    expect(currentProfile().routines.map(r => r.id)).toEqual(['r_dan', 'tr_0000000000000001'])
    expect((await h.http('GET', `/api/media/${sha(video)}`, { uid: DAN.id })).status).toBe(200)
    await sync()

    // Neither client reads the other's progress, assignment or demo access; each reads only its own.
    for (const [uid, other] of [[CAT.id, danLink.id], [DAN.id, catLink.id]]) {
      expect([403, 404]).toContain((await h.http('GET', `/api/trainer/progress?link=${other}`, { uid })).status)
      expect((await h.http('POST', '/api/trainer/assignment/ack', { uid, body: { link: other, rev: 1, outcome: 'discarded', routineIds: [] } })).status).toBe(404)
      expect((await h.http('POST', '/api/trainer/links/update', { uid, body: { id: other, shareBodyweight: false } })).status).toBe(404)
    }
    expect(ok(await h.http('GET', '/api/trainer/assignment', { uid: CAT.id })).link.id).toBe(catLink.id)
    // Anna sees each client's own data under each link, and Dan's body weight because he shares it.
    const danProgress = ok(await h.http('GET', `/api/trainer/progress?link=${danLink.id}`, { uid: ANNA.id }))
    expect(danProgress.bodyweight).toEqual([{ d: '2026-10-09', w: 75 }])
    expect(JSON.stringify(danProgress)).not.toContain('w_cat')
    const catProgress = ok(await h.http('GET', `/api/trainer/progress?link=${catLink.id}`, { uid: ANNA.id }))
    expect('bodyweight' in catProgress).toBe(false)
    expect(JSON.stringify(catProgress)).not.toContain('Dan')
  }, 60000)

  it('revocation from either side: progress and demo access end at once; the client keeps its plan', async () => {
    await boot()
    const { video, prog } = await trainerLibrary()
    // Cat ends her link in the app; Dan's is ended by Anna.
    for (const [user, by] of [[CAT, 'client'], [DAN, 'trainer']]) {
      signIn(user)
      ok(await h.http('POST', '/api/trainer/links/accept', { uid: user.id, body: { code: await newInvite(), mode: 'trainer-managed' } }), 201)
      const link = ok(await h.http('GET', '/api/trainer/links', { uid: user.id })).asClient
      await publish(link.id, prog.id)
      await mount()
      await inboxLooks()
      await sync()
      const R1 = 'tr_0000000000000001'
      expect(routine(currentProfile(), R1)).toBeTruthy()
      expect((await h.http('GET', `/api/media/trainer?hash=${sha(video)}&trainer=${ANNA.id}`, { uid: user.id })).status).toBe(200)

      if (by === 'client') {
        await click(button(T.endLink))
        expect(host.textContent).toContain(T.endLinkClient(ANNA.name))
        await click(buttons().filter(b => b.textContent.trim() === T.endLink).at(-1))
        expect(host.textContent).toContain(T.ended)
      } else {
        ok(await h.http('POST', '/api/trainer/links/revoke', { uid: ANNA.id, body: { id: link.id } }))
      }
      // At once: progress, publishing and the demo are gone for the other side.
      expect((await h.http('GET', `/api/trainer/progress?link=${link.id}`, { uid: ANNA.id })).status).toBe(404)
      expect((await h.http('POST', '/api/trainer/assignments/publish', { uid: ANNA.id, body: { link: link.id, baseRev: 2 } })).status).toBe(404)
      expect((await h.http('GET', `/api/media/trainer?hash=${sha(video)}&trainer=${ANNA.id}`, { uid: user.id })).status).toBe(404)
      // The plan stays, as ordinary routines, with the demo in the client's own media.
      await inboxLooks()
      expect(routine(currentProfile(), R1)).toBeTruthy()
      expect(routine(await serverState(user.id), R1)).toBeTruthy()
      expect((await h.http('GET', `/api/media/${sha(video)}`, { uid: user.id })).status).toBe(200)
      expect(ok(await h.http('GET', '/api/trainer/assignment', { uid: user.id }))).toEqual({ linked: false })
      unmount()
    }
  }, 60000)

  it('with TRAINER unset the app asks once, gets the plain 404, and shows and polls nothing', async () => {
    await boot({})
    signIn(CAT)
    await mount()
    await inboxLooks()
    expect(host.querySelector('.home')).toBeTruthy()
    expect(api.mock.calls.map(c => c[0])).toEqual(['/api/trainer/status'])
  }, 30000)
})

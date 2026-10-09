// @vitest-environment happy-dom
// The module's two hook points render nothing unless the server reports the module on: a guest,
// a signed-out device and a server without it (404, an upstream build or TRAINER unset) see the
// app exactly as upstream ships it. Switched on, the trainer page works against the module's real
// routes (api/trainer/routes.js, in-process): the switch, an exercise with a demo upload and its
// progress, a programme from library and built-in exercises, an unknown built-in id, a conflict,
// archiving and the export.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiUpload: vi.fn(), apiBlob: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('../lib/media-ingest.js', () => ({ ingestMediaFile: vi.fn() }))

import { api, apiUpload, apiBlob } from '../lib/api.js'
import { ingestMediaFile } from '../lib/media-ingest.js'
import { DEF, useStore } from '../store/useStore.js'
import { TrainerRoot, TrainerInbox } from './index.js'
import { fetchTrainerStatus, forgetTrainerStatus, OFF } from './status.js'
import { TEXT } from './strings.js'
import { harness } from '../../../api/trainer/test/inproc.mjs'
import { exerciseBody, jpeg, mp4, sha, videoRef } from '../../../api/trainer/test/samples.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const USER = { id: 'u1', name: 'One' }
const ANNA = { id: 'u_anna', name: 'Anna' }
const notFound = () => Object.assign(new Error('not found'), { status: 404, data: { error: 'not found' } })
let root, host, srv, cleanups, where

function Where() { where = useLocation().pathname; return null }

async function mount(user, path = '/trainer') {
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user, config: { media: { imageMB: 2, gifMB: 8, videoMB: 40, videoSec: 60, quotaMB: 200 } } })
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
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(() => new Promise(r => setTimeout(r, 0))) }
// Settles until `cond` holds, up to `ms`: work that goes through the in-process server (an upload
// read, hashed and stored) can take longer than a fixed number of ticks on a slow CI runner.
const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for the screen to settle')
    await settle(1)
  }
}

/** The app's calls, answered by the module's real routes for `uid` (the harness in api/trainer/test). */
function connect(uid) {
  srv = harness({ after: fn => cleanups.push(fn) })
  const fail = r => Object.assign(new Error(r.body?.error || 'HTTP ' + r.status), { status: r.status, code: r.body?.code, data: r.body || {} })
  api.mockImplementation(async (p, opts = {}) => {
    const r = await srv.call((opts.method || 'GET').toUpperCase(), p, { uid, body: opts.body ? JSON.parse(opts.body) : undefined })
    if (r.status >= 400) throw fail(r)
    return r.body
  })
  apiUpload.mockImplementation(async (p, blob, mime, { onProgress } = {}) => {
    onProgress?.(blob.size, blob.size)
    const r = await srv.call('PUT', p, { uid, upload: { bytes: Buffer.from(await blob.arrayBuffer()), mime } })
    if (r.status >= 400) throw fail(r)
    return r.body
  })
  apiBlob.mockImplementation(async p => {
    const r = await srv.call('GET', p, { uid })
    if (r.status !== 200) throw fail(r)
    return new Blob([r.bytes])
  })
  return srv
}
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
// The trainer-tools switch (the page also has the client's body-weight switch, FIT-004).
const enableSwitch = () => host.querySelector(`[role="switch"][aria-label="${TEXT.enable}"]`)

beforeEach(() => {
  forgetTrainerStatus()
  cleanups = []
  for (const m of [api, apiUpload, apiBlob, ingestMediaFile]) m.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:demo')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  for (const fn of cleanups) fn()
})

describe('the trainer page', () => {
  it('a guest: nothing asked, and the address goes home as upstream\'s catch-all would send it', async () => {
    await mount(null)
    expect(api).not.toHaveBeenCalled()
    expect(host.querySelector('.home')).toBeTruthy()
    expect(host.querySelector('.trainer-root')).toBeNull()
  })

  it('a server without the module (404): home, and no trace of the module', async () => {
    api.mockRejectedValue(notFound())
    await mount(USER)
    expect(api).toHaveBeenCalledWith('/api/trainer/status')
    expect(host.querySelector('.home')).toBeTruthy()
    expect(host.querySelector('.trainer-root')).toBeNull()
  })

  it('switched on: the page, with the version the server runs; the status asked once for page and inbox together', async () => {
    connect(ANNA.id)
    await mount(ANNA, '/trainer')
    expect(host.querySelector('.trainer-root')).toBeTruthy()
    expect([...host.querySelectorAll('.trainer-root .lrow-v')].map(e => e.textContent)).toContain('v0.3.1')
    expect(api.mock.calls.filter(c => c[0] === '/api/trainer/status')).toHaveLength(1)
  })

  it('an unknown trainer address goes back to the trainer page', async () => {
    connect(ANNA.id)
    await mount(ANNA, '/trainer/nothing/here')
    expect(where).toBe('/trainer')
  })
})

describe('the status answer', () => {
  it('remembers a 404 and an answer, never a failure that is not one', async () => {
    api.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: undefined }))
    expect(await fetchTrainerStatus('u2')).toBe(OFF)
    api.mockResolvedValueOnce({ enabled: true, module: '0.1.0' })
    expect(await fetchTrainerStatus('u2')).toEqual({ enabled: true, module: '0.1.0' })
    expect(await fetchTrainerStatus('u2')).toEqual({ enabled: true, module: '0.1.0' })
    expect(api).toHaveBeenCalledTimes(2)
    api.mockRejectedValueOnce(notFound())
    expect(await fetchTrainerStatus('u3')).toBe(OFF)
    expect(await fetchTrainerStatus('u3')).toBe(OFF)
    expect(api).toHaveBeenCalledTimes(3)
  })

  it('an answer that is not "enabled: true" is off', async () => {
    api.mockResolvedValueOnce({ enabled: 'yes' })
    expect(await fetchTrainerStatus('u4')).toBe(OFF)
  })
})

describe('trainer tools', () => {
  it('off by default: only the switch; switching on shows the library, switching off hides it and keeps it', async () => {
    const s = connect(ANNA.id)
    await mount(ANNA)
    const sw = enableSwitch()
    expect(sw.getAttribute('aria-label')).toBe(TEXT.enable)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(button(TEXT.newExercise)).toBeUndefined()
    await click(sw)
    expect(enableSwitch().getAttribute('aria-checked')).toBe('true')
    expect(button(TEXT.newExercise)).toBeTruthy()
    expect(button(TEXT.newProgramme)).toBeTruthy()
    await s.call('POST', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: 0, exercise: exerciseBody() } })
    await click(enableSwitch())
    expect(button(TEXT.newExercise)).toBeUndefined()
    expect(s.internals.library.read(ANNA.id).exercises).toHaveLength(1)
  })

  it('outside TRAINER_ALLOW the switch is off and cannot be turned on', async () => {
    srv = harness({ after: fn => cleanups.push(fn) }, { env: { TRAINER_ALLOW: 'u_someone' } })
    const s = srv
    api.mockImplementation(async (p, opts = {}) => (await s.call((opts.method || 'GET').toUpperCase(), p, { uid: ANNA.id })).body)
    await mount(ANNA)
    expect(enableSwitch().disabled).toBe(true)
    expect(text()).toContain(TEXT.notAllowed)
  })

  it('creates an exercise with a demo video: prepared by upstream\'s ingest, uploaded with progress, saved with its MediaRef', async () => {
    const s = connect(ANNA.id)
    await s.on(ANNA.id)
    const video = mp4({ bytes: 3000 }), poster = jpeg(1000)
    ingestMediaFile.mockResolvedValue({
      media: videoRef(video, poster),
      blobs: [{ hash: sha(video), blob: new Blob([video]), mime: 'video/mp4' }, { hash: sha(poster), blob: new Blob([poster]), mime: 'image/jpeg' }],
      warnings: [],
    })
    await mount(ANNA)
    await click(button(TEXT.newExercise))
    expect(where).toBe('/trainer/exercises/new')

    await type(host.querySelector('#trainer-ex-name'), 'Split squat')
    await click(buttons().find(b => b.getAttribute('aria-pressed') === 'false' && b.textContent === 'upper legs'))
    await type(host.querySelector('textarea'), 'Front shin vertical.')

    // The first upload stops half-way, so the progress can be seen.
    let release
    const real = apiUpload.getMockImplementation()
    apiUpload.mockImplementationOnce(async (p, blob, mime, opts) => {
      opts.onProgress(blob.size / 2, blob.size)
      await new Promise(r => { release = r })
      return real(p, blob, mime, { ...opts, onProgress: undefined })
    })
    const file = new File([video], 'IMG_0001.MOV', { type: 'video/quicktime' })
    const input = host.querySelector('[data-testid="demo-file"]')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await settle()
    expect(ingestMediaFile).toHaveBeenCalledWith(file, expect.objectContaining({ videoMB: 40, quotaMB: 500 }))
    const bar = host.querySelector('progress')
    expect(bar.getAttribute('aria-label')).toBe(TEXT.uploading)
    const pct = Math.round((100 * video.length / 2) / (video.length + poster.length))
    expect(Number(bar.getAttribute('value'))).toBe(pct)
    expect(text()).toContain(TEXT.uploadingPct(pct))
    release()
    await until(() => host.querySelector('progress') === null)
    expect(host.querySelector('progress')).toBeNull()
    expect(text()).toContain(TEXT.videoKind)
    expect(host.querySelector('video')?.getAttribute('src')).toBe('blob:demo')   // the preview, from the demo store

    await click(button(TEXT.create))
    expect(where).toBe('/trainer')
    expect(text()).toContain('Split squat')
    expect(text()).toContain(TEXT.withDemo)
    const stored = s.internals.library.read(ANNA.id).exercises[0]
    expect(stored).toMatchObject({ n: 'Split squat', bp: 'upper legs', desc: 'Front shin vertical.', rev: 1, media: { hash: sha(video), poster: { hash: sha(poster) } } })
    expect(s.internals.demo.store.has(ANNA.id, sha(video))).toBe(true)
    expect(s.internals.demo.store.has(ANNA.id, sha(poster))).toBe(true)
  })

  it('says what is wrong before sending, and says why a refused demo was refused', async () => {
    const s = connect(ANNA.id)
    await s.on(ANNA.id)
    await mount(ANNA, '/trainer/exercises/new')
    await click(button(TEXT.create))
    expect(host.querySelector('[role="alert"]').textContent).toBe(TEXT.invalid.n)
    expect(api.mock.calls.some(c => c[1]?.method === 'POST' && c[0].includes('/exercises'))).toBe(false)
    ingestMediaFile.mockRejectedValue(Object.assign(new Error('too-long'), { code: 'too-long', sec: 60 }))
    const input = host.querySelector('[data-testid="demo-file"]')
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'long.mp4')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await settle()
    expect(text()).toContain(TEXT.demoError['too-long'](60))
  })

  it('edits and archives an exercise; a change made elsewhere meanwhile is a conflict, not an overwrite', async () => {
    const s = connect(ANNA.id)
    await s.on(ANNA.id)
    const ex = (await s.call('POST', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: 0, exercise: exerciseBody({ n: 'Goblet squat' }) } })).body.exercise
    await mount(ANNA)
    await click(button('Goblet squat'))
    expect(where).toBe(`/trainer/exercises/${ex.id}`)
    await type(host.querySelector('textarea'), 'Elbows inside the knees.')
    // Another tab saves first.
    await s.call('PUT', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: 1, id: ex.id, exercise: exerciseBody({ n: 'Goblet squat', desc: 'From the other tab' }) } })
    await click(button(TEXT.save))
    expect(host.querySelector('[role="alert"]').textContent).toBe(TEXT.conflict)
    expect(s.internals.library.read(ANNA.id).exercises[0].desc).toBe('From the other tab')
    // Told, the trainer saves again over the library she now has.
    await click(button(TEXT.save))
    expect(where).toBe('/trainer')
    expect(s.internals.library.read(ANNA.id).exercises[0]).toMatchObject({ desc: 'Elbows inside the knees.', rev: 3 })
    await click(button('Goblet squat'))
    await click(button(TEXT.archive))
    expect(where).toBe('/trainer')
    expect(text()).toContain(TEXT.archivedExercises)
    expect(s.internals.library.read(ANNA.id).exercises[0].archived).toBe(true)
  })

  it('builds a programme from a library exercise and a built-in one found by search', async () => {
    const s = connect(ANNA.id)
    await s.on(ANNA.id)
    const ex = (await s.call('POST', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: 0, exercise: exerciseBody({ n: 'Split squat' }) } })).body.exercise
    await mount(ANNA)
    await click(button(TEXT.newProgramme))
    await type(host.querySelector('#trainer-prog-name'), 'Block 1')
    await click(button(TEXT.addExercise))
    await click(button('Split squat'))
    await click(button(TEXT.addExercise))
    await type(host.querySelector('.searchf input'), 'barbell full squat')
    await click(buttons().find(b => b.querySelector('.lrow-t')?.textContent.toLowerCase() === 'barbell full squat'))
    const reps = host.querySelectorAll('[data-slot="0043"] input')[1]
    await type(reps, '5')
    await click(button(TEXT.addRoutine))
    await click(button(TEXT.create))
    expect(where).toBe('/trainer')
    const [p] = s.internals.library.read(ANNA.id).programmes
    expect(p.name).toBe('Block 1')
    expect(p.routines.map(r => r.name)).toEqual(['Day 1', 'Day 2'])
    expect(p.routines[0].ex).toEqual([{ id: ex.id, sets: 3, reps: 10 }, { id: '0043', catalog: 'og1', sets: 3, reps: 5 }])
    expect(text()).toContain('Block 1')
  })

  it('an unknown built-in id is shown as unknown and kept when the programme is saved', async () => {
    const s = connect(ANNA.id)
    await s.on(ANNA.id)
    const made = await s.call('POST', '/api/trainer/library/programmes', { uid: ANNA.id, body: { baseRev: 0, programme: { name: 'Old', routines: [{ id: 'tr_' + '0'.repeat(16), name: 'A', ex: [{ id: '9999', catalog: 'og1', sets: 2 }, { id: '0043', catalog: 'og1', sets: 3 }] }] } } })
    expect(made.status).toBe(201)
    await mount(ANNA, `/trainer/programmes/${made.body.programme.id}`)
    expect(text()).toContain(TEXT.unknownExercise('9999'))
    expect(text()).toContain(TEXT.unknownHint)
    expect(text().toLowerCase()).toContain('barbell full squat')
    await type(host.querySelector('#trainer-prog-name'), 'Old, renamed')
    await click(button(TEXT.save))
    expect(where).toBe('/trainer')
    const [p] = s.internals.library.read(ANNA.id).programmes
    expect(p.name).toBe('Old, renamed')
    expect(p.routines[0].ex[0]).toEqual({ id: '9999', catalog: 'og1', sets: 2 })
  })

  it('exports the library as a downloaded JSON file', async () => {
    const s = connect(ANNA.id)
    await s.on(ANNA.id)
    await s.call('POST', '/api/trainer/library/exercises', { uid: ANNA.id, body: { baseRev: 0, exercise: exerciseBody() } })
    await mount(ANNA)
    await click(button(TEXT.exportTitle))
    const blob = URL.createObjectURL.mock.calls.at(-1)[0]
    const data = JSON.parse(await blob.text())
    expect(data.opengym_trainer_library).toBe(1)
    expect(data.exercises).toHaveLength(1)
  })
})

describe('demo usage line', () => {
  it('shows KB below 1 MB, so a few small uploads do not read as nothing', async () => {
    const { sizeText } = await import('./TrainerHome.jsx')
    expect(sizeText(0)).toBe('0 MB')
    expect(sizeText(1)).toBe('1 KB')
    expect(sizeText(43246)).toBe('43 KB')
    expect(sizeText(1048576)).toBe('1 MB')
    expect(sizeText(500 * 1048576)).toBe('500 MB')
    expect(sizeText(1.26 * 1048576)).toBe('1.3 MB')
  })
})

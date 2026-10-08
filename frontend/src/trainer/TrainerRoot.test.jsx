// @vitest-environment happy-dom
// The module's two hook points render nothing unless the server reports the module on: a guest,
// a signed-out device and a server without it (404, an upstream build or TRAINER unset) see the
// app exactly as upstream ships it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))

import { api } from '../lib/api.js'
import { DEF, useStore } from '../store/useStore.js'
import { TrainerRoot, TrainerInbox } from './index.js'
import { fetchTrainerStatus, forgetTrainerStatus, OFF } from './status.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const USER = { id: 'u1', name: 'One' }
const notFound = () => Object.assign(new Error('not found'), { status: 404, data: { error: 'not found' } })
let root, host

async function mount(user, path = '/trainer') {
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user })
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
}

beforeEach(() => { forgetTrainerStatus(); api.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove() })

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

  it('switched on: the page, with the version the server runs; asked once for page and inbox together', async () => {
    api.mockResolvedValue({ enabled: true, module: '0.1.0' })
    await mount(USER, '/trainer/anything')
    expect(host.querySelector('.trainer-root')).toBeTruthy()
    expect(host.querySelector('.trainer-root .lrow-v').textContent).toBe('v0.1.0')
    expect(api).toHaveBeenCalledTimes(1)
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

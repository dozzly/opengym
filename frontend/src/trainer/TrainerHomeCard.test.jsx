// @vitest-environment happy-dom
// The card on Home (TrainerHomeCard.jsx): nothing while the module is off; for a linked client, a
// trainer, a named-but-not-yet trainer and anyone else, the right words; Hide for the last; a tap
// opens #/trainer.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client.js', () => ({ getCapability: vi.fn(), getLinks: vi.fn() }))
vi.mock('./status.js', () => ({ useTrainerStatus: vi.fn() }))
import { getCapability, getLinks } from './client.js'
import { useTrainerStatus } from './status.js'
import { useStore } from './adapter.js'
import TrainerHomeCard from './TrainerHomeCard.jsx'
import { HOME_TEXT as T } from './strings.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, where
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(() => new Promise(r => setTimeout(r, 0))) }
function Where() { where = useLocation().pathname; return null }

async function mount({ on = true, cap = { enabled: false, allowed: false, restricted: true }, links = { asTrainer: [], asClient: null } } = {}) {
  useTrainerStatus.mockReturnValue(on ? { enabled: true, module: '0.3.0' } : { enabled: false })
  getCapability.mockResolvedValue(cap)
  getLinks.mockResolvedValue(links)
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/home']}>
      <Where />
      <Routes><Route path="/home" element={<TrainerHomeCard />} /><Route path="/trainer" element={<div>trainer screen</div>} /></Routes>
    </MemoryRouter>))
  await settle()
}
const card = () => host.querySelector('[data-testid="trainer-home-card"]')

beforeEach(() => { localStorage.clear(); useStore.setState({ user: { id: 'u_me', name: 'Me' } }) })
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.clearAllMocks() })

describe('TrainerHomeCard', () => {
  it('shows nothing while the server runs without the module', async () => {
    await mount({ on: false })
    expect(card()).toBeNull()
    expect(getCapability).not.toHaveBeenCalled()
  })
  it('a linked client sees their trainer and how updates arrive; a tap opens the trainer screen', async () => {
    await mount({ links: { asTrainer: [], asClient: { id: 'lk_1', trainer: { name: 'Anna' }, mode: 'trainer-managed' } } })
    expect(card().textContent).toContain(T.yourTrainer)
    expect(card().textContent).toContain(T.linkedSub('Anna', 'trainer-managed'))
    await act(async () => { card().click() })
    expect(where).toBe('/trainer')
  })
  it('a trainer with tools on sees their clients', async () => {
    await mount({ cap: { enabled: true, allowed: true, restricted: true }, links: { asTrainer: [{ id: 'lk_1' }, { id: 'lk_2' }], asClient: null } })
    expect(card().textContent).toContain(T.trainer)
    expect(card().textContent).toContain(T.trainerSub(2))
  })
  it('the person TRAINER_ALLOW names is offered set-up; with no TRAINER_ALLOW nobody is', async () => {
    await mount({ cap: { enabled: false, allowed: true, restricted: true } })
    expect(card().textContent).toContain(T.setUp)
    act(() => root.unmount()); host.remove()
    await mount({ cap: { enabled: false, allowed: true, restricted: false } })
    expect(card().textContent).toContain(T.haveCode)
  })
  it('anyone else is asked for a code, and can hide that on this device', async () => {
    await mount()
    expect(card().textContent).toContain(T.haveCode)
    const hide = [...card().querySelectorAll('button')].find(b => b.textContent === T.hide)
    await act(async () => { hide.click() })
    expect(card()).toBeNull()
    expect(where).toBe('/home')
    act(() => root.unmount()); host.remove()
    await mount()
    expect(card()).toBeNull()
  })
})

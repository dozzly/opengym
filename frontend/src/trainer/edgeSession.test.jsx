// @vitest-environment happy-dom
// The proxy-session keeper (edgeSession.js, EdgeSessionKeeper.jsx): a redirected API means a reload,
// or a Reconnect offer during a workout; nothing for offline or a healthy answer; never a reload loop.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { edgeRedirected, reloadAllowed, markReload, RELOAD_GAP_MS } from './edgeSession.js'
import EdgeSessionKeeper from './EdgeSessionKeeper.jsx'
import { useStore } from './adapter.js'
import { EDGE_TEXT as T } from './strings.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(() => new Promise(r => setTimeout(r, 0))) }
async function mount(props) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<EdgeSessionKeeper every={3600000} {...props} />))
  await settle()
}
beforeEach(() => { sessionStorage.clear(); useStore.setState({ S: { ...(useStore.getState().S || {}), active: null } }) })
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('edgeRedirected', () => {
  it('is true for the proxy\'s redirect, false for an answer or a failure', async () => {
    expect(await edgeRedirected({ fetchImpl: async () => ({ type: 'opaqueredirect', status: 0 }), base: 'https://gym.example/' })).toBe(true)
    expect(await edgeRedirected({ fetchImpl: async () => ({ type: 'basic', status: 302 }), base: 'https://gym.example/' })).toBe(true)
    expect(await edgeRedirected({ fetchImpl: async () => ({ type: 'basic', status: 200 }), base: 'https://gym.example/' })).toBe(false)
    expect(await edgeRedirected({ fetchImpl: async () => { throw new TypeError('offline') }, base: 'https://gym.example/' })).toBe(false)
  })
  it('asks the app\'s own api/health without following redirects', async () => {
    const f = vi.fn(async () => ({ type: 'basic', status: 200 }))
    await edgeRedirected({ fetchImpl: f, base: 'https://gym.example/' })
    expect(f).toHaveBeenCalledWith('https://gym.example/api/health', expect.objectContaining({ redirect: 'manual', cache: 'no-store' }))
  })
})

describe('reloadAllowed', () => {
  it('allows one reload per two minutes on this tab', () => {
    expect(reloadAllowed(1_000_000)).toBe(true)
    markReload(1_000_000)
    expect(reloadAllowed(1_000_000 + RELOAD_GAP_MS - 1)).toBe(false)
    expect(reloadAllowed(1_000_000 + RELOAD_GAP_MS)).toBe(true)
  })
})

describe('EdgeSessionKeeper', () => {
  it('reloads by itself when the session ended and no workout runs', async () => {
    const reload = vi.fn()
    await mount({ probe: async () => true, reload })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="edge-reconnect"]')).toBeNull()
  })
  it('during a workout it offers Reconnect instead, and the button reloads', async () => {
    useStore.setState({ S: { ...useStore.getState().S, active: { id: 'w1' } } })
    const reload = vi.fn()
    await mount({ probe: async () => true, reload })
    expect(reload).not.toHaveBeenCalled()
    const banner = host.querySelector('[data-testid="edge-reconnect"]')
    expect(banner.textContent).toContain(T.stale)
    await act(async () => { [...banner.querySelectorAll('button')].find(b => b.textContent === T.reconnect).click() })
    expect(reload).toHaveBeenCalledTimes(1)
  })
  it('does nothing while the API answers', async () => {
    const reload = vi.fn()
    await mount({ probe: async () => false, reload })
    expect(reload).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="edge-reconnect"]')).toBeNull()
  })
  it('never loops: a second redirect within two minutes offers Reconnect rather than reloading again', async () => {
    markReload(Date.now())
    const reload = vi.fn()
    await mount({ probe: async () => true, reload })
    expect(reload).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="edge-reconnect"]')).toBeTruthy()
  })
})

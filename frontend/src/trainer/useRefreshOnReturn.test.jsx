// @vitest-environment happy-dom
// The link screens reload their data when the person comes back to the app (useRefreshOnReturn).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRefreshOnReturn } from './useRefreshOnReturn.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
afterEach(() => { act(() => root?.unmount()); host?.remove() })

function Probe({ loads }) { useRefreshOnReturn(...loads); return null }
function mount(loads) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Probe loads={loads} />))
}

describe('useRefreshOnReturn', () => {
  it('reloads every given loader when the window regains focus', () => {
    const a = vi.fn(), b = vi.fn()
    mount([a, b])
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
  it('reloads when the app becomes visible again, not when it is hidden', () => {
    const a = vi.fn()
    mount([a])
    const vis = vi.spyOn(document, 'visibilityState', 'get')
    vis.mockReturnValue('hidden'); act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(a).not.toHaveBeenCalled()
    vis.mockReturnValue('visible'); act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(a).toHaveBeenCalledTimes(1)
    vis.mockRestore()
  })
  it('stops listening once the screen is gone', () => {
    const a = vi.fn()
    mount([a])
    act(() => root.unmount()); root = null
    window.dispatchEvent(new Event('focus'))
    expect(a).not.toHaveBeenCalled()
  })
})

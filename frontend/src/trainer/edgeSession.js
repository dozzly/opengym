// The Authentik forward-auth proxy in front of the app redirects every request once its session
// ends. The app's fetch() calls cannot follow that cross-site redirect, so upstream reports "Your
// server can't be reached" although nothing is down. A full page load goes through Authentik
// (silently while its own login is still valid) and comes back with a fresh session. This module
// notices the redirect and does that reload, or, while a workout runs, offers it instead.
//
// Pure helpers plus a hook; EdgeSessionKeeper.jsx renders the offer.
import { useEffect, useRef, useState } from 'react'

export const CHECK_MS = 60000
export const RELOAD_GAP_MS = 2 * 60000
const RELOAD_KEY = 'opengym.edge.reloadAt'

/** Whether the proxy in front redirects the app's own API: a fresh session is needed. Offline or
 *  any other failure is not this case (upstream's own banner covers it). */
export async function edgeRedirected({ fetchImpl = globalThis.fetch, base = globalThis.document?.baseURI } = {}) {
  try {
    const url = new URL('api/health', base || 'http://localhost/').href
    const r = await fetchImpl(url, { redirect: 'manual', cache: 'no-store', credentials: 'same-origin' })
    return r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)
  } catch { return false }
}

/** At most one reload per RELOAD_GAP_MS on this tab, so an Authentik that wants a real sign-in is
 *  shown once rather than looped through. */
export function reloadAllowed(now = Date.now(), store = globalThis.sessionStorage) {
  try { return !(now - Number(store?.getItem(RELOAD_KEY) || 0) < RELOAD_GAP_MS) } catch { return true }
}
export function markReload(now = Date.now(), store = globalThis.sessionStorage) {
  try { store?.setItem(RELOAD_KEY, String(now)) } catch { /* private mode */ }
}

/** Checks on start, when the app comes back to the foreground or gets the focus, and every minute
 *  while visible. Reloads when the session ended and no workout runs; during a workout it returns
 *  `stale: true` so the screen can offer the reload instead. */
export function useEdgeSessionKeeper({ workoutRunning = false, reload = () => globalThis.location.reload(), probe = edgeRedirected, every = CHECK_MS } = {}) {
  const [stale, setStale] = useState(false)
  const running = useRef(workoutRunning)
  running.current = workoutRunning
  const busy = useRef(false)
  useEffect(() => {
    let live = true
    const look = async () => {
      if (busy.current || globalThis.document?.visibilityState === 'hidden') return
      busy.current = true
      try {
        const redirected = await probe()
        if (!live) return
        if (!redirected) { setStale(false); return }
        if (!running.current && reloadAllowed()) { markReload(); reload(); return }
        setStale(true)
      } finally { busy.current = false }
    }
    look()
    const onVisible = () => { if (globalThis.document?.visibilityState === 'visible') look() }
    globalThis.addEventListener?.('focus', look)
    globalThis.document?.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(look, every)
    return () => {
      live = false
      clearInterval(timer)
      globalThis.removeEventListener?.('focus', look)
      globalThis.document?.removeEventListener('visibilitychange', onVisible)
    }
  }, [probe, reload, every])
  return { stale, reconnect: () => { markReload(); reload() } }
}

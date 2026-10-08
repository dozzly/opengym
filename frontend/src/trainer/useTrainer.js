// The trainer page's state: the capability switch and the library, kept in step with the server.
// Every write names the revision it was based on; a 409 brings the current library back, which
// replaces the one on screen, and the editor says so instead of overwriting another tab's change.
import { useCallback, useEffect, useState } from 'react'
import { getCapability, setCapability, getLibrary, writeLibrary, withWrite, withConflict } from './client.js'
import { TEXT } from './strings.js'

export function useTrainer() {
  const [cap, setCap] = useState(null)       // { enabled, allowed }
  const [lib, setLib] = useState(null)       // GET /api/trainer/library, or null
  const [error, setError] = useState(null)

  const loadLibrary = useCallback(async () => {
    try { setLib(await getLibrary()); setError(null) }
    catch (e) { setLib(null); setError(e?.status === 503 ? TEXT.unreadable : TEXT.loadFailed) }
  }, [])

  useEffect(() => {
    let live = true
    getCapability()
      .then(c => { if (!live) return; setCap(c); if (c.enabled) loadLibrary() })
      .catch(() => { if (live) setError(TEXT.loadFailed) })
    return () => { live = false }
  }, [loadLibrary])

  const setEnabled = useCallback(async on => {
    try {
      const c = await setCapability(on)
      setCap(c)
      setError(null)
      if (c.enabled) await loadLibrary()
      else setLib(null)
    } catch (e) { setError(e?.status === 403 ? TEXT.notAllowed : TEXT.failed) }
  }, [loadLibrary])

  /** One write. Resolves { ok, item } | { conflict: true } | { error, status, data }. */
  const write = useCallback(async (kind, method, body) => {
    const base = lib || { rev: 0, wid: null }
    try {
      const res = await writeLibrary(kind, method, { ...body, baseRev: base.rev, ...(base.wid ? { baseWid: base.wid } : {}) })
      setLib(cur => withWrite(cur || base, kind, res))
      return { ok: true, item: res.exercise || res.programme }
    } catch (e) {
      if (e?.status === 409 && e.data?.library) { setLib(cur => withConflict(cur || base, e.data.library)); return { conflict: true } }
      return { error: e, status: e?.status, data: e?.data || {} }
    }
  }, [lib])

  const noteUsage = useCallback(usage => {
    setLib(cur => (cur && cur.media ? { ...cur, media: { ...cur.media, usage } } : cur))
  }, [])

  return { cap, lib, error, setEnabled, write, noteUsage, reload: loadLibrary }
}

/** The sentence for a failed write's answer. */
export function writeErrorText(r) {
  if (r.conflict) return TEXT.conflict
  if (r.status === 503) return TEXT.unreadable
  if (r.status === 403) return TEXT.off
  if (r.status === 400 || r.status === 404) return null   // the caller explains the field
  return TEXT.failed
}

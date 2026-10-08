// Whether this server runs the trainer module (GET /api/trainer/status), asked once per signed-in
// profile. A 404 is the answer of a server with the module switched off, or of an upstream build:
// the module stays out of sight. Any other failure (offline, a session that just ended) is not an
// answer, so it is not remembered and the next mount asks again.
import { useEffect, useState } from 'react'
import { api, useUser } from './adapter.js'

export const OFF = Object.freeze({ enabled: false })
const known = new Map()    // uid -> { enabled, module }
const asking = new Map()   // uid -> the request in flight

export function fetchTrainerStatus(uid) {
  if (!uid) return Promise.resolve(OFF)
  if (known.has(uid)) return Promise.resolve(known.get(uid))
  if (!asking.has(uid)) {
    asking.set(uid, api('/api/trainer/status')
      .then(r => (r && r.enabled === true ? { enabled: true, module: String(r.module || '') } : OFF))
      .catch(e => (e && e.status === 404 ? OFF : null))
      .then(s => {
        asking.delete(uid)
        if (s) known.set(uid, s)
        return s || OFF
      }))
  }
  return asking.get(uid)
}

/** Forgets every answer (tests, and a later sign-out handler). */
export function forgetTrainerStatus() {
  known.clear()
  asking.clear()
}

/** The status for the signed-in profile: null while asking, OFF for a guest or a server without it. */
export function useTrainerStatus() {
  const uid = useUser()?.id || null
  const [status, setStatus] = useState(() => (uid ? known.get(uid) || null : OFF))
  useEffect(() => {
    let live = true
    if (!uid) { setStatus(OFF); return }
    if (known.has(uid)) { setStatus(known.get(uid)); return }
    setStatus(null)
    fetchTrainerStatus(uid).then(s => { if (live) setStatus(s) })
    return () => { live = false }
  }, [uid])
  return status
}

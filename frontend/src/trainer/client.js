// The module's calls to its own routes (api/trainer/routes.js), through upstream's api() and its
// media transports, so they go to the same server with the same credentials as everything else.
import { api, apiUpload, apiBlob } from './adapter.js'

const send = (path, method, body) => api(path, { method, body: JSON.stringify(body) })

export const getCapability = () => api('/api/trainer/capability')
export const setCapability = enabled => send('/api/trainer/capability', 'POST', { enabled })
export const getLibrary = () => api('/api/trainer/library')
export const getExport = () => api('/api/trainer/library/export')

/** One library write: `kind` is 'exercises' or 'programmes', `method` POST (create), PUT (edit)
 *  or DELETE (archive). `body` carries baseRev/baseWid. */
export const writeLibrary = (kind, method, body) => send(`/api/trainer/library/${kind}`, method, body)

/** A demo file to the trainer's demo store, with progress: (loaded, total). */
export const uploadDemo = (blob, hash, mime, onProgress) => apiUpload(`/api/media/trainer?hash=${hash}`, blob, mime, { onProgress })
/** A demo file of the trainer's own, as a Blob. */
export const fetchDemo = (hash, size) => apiBlob(`/api/media/trainer?hash=${hash}`, { expectSize: size })

/** The library after a write the server accepted: its new revision, and the item it answered with
 *  in place of the old one (or added). Pure. */
export function withWrite(lib, kind, res) {
  const item = res.exercise || res.programme
  const list = lib[kind] || []
  const i = list.findIndex(x => x.id === item.id)
  return { ...lib, rev: res.rev, wid: res.wid, [kind]: i < 0 ? [...list, item] : list.map(x => (x.id === item.id ? item : x)) }
}

/** The library a 409 carried, keeping what only the GET answer has (owner, media usage). */
export const withConflict = (lib, current) => ({ ...current, owner: lib.owner, media: lib.media })

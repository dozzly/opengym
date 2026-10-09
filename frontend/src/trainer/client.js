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

/* ---------- FIT-004: consent, assignments, progress (api/trainer/link-routes.js) ---------- */

export const createInvite = () => send('/api/trainer/invites', 'POST', {})
export const getInvites = () => api('/api/trainer/invites')
export const revokeInvite = id => send('/api/trainer/invites', 'DELETE', { id })
export const getLinks = () => api('/api/trainer/links')
export const acceptInvite = (code, mode, shareBodyweight) => send('/api/trainer/links/accept', 'POST', { code, mode, shareBodyweight })
export const updateLink = (id, patch) => send('/api/trainer/links/update', 'POST', { id, ...patch })
export const revokeLink = id => send('/api/trainer/links/revoke', 'POST', { id })

const q = encodeURIComponent
/** The trainer's view of one link's assignment: draft, published, applied, the server's preview. */
export const getAssignmentFor = link => api(`/api/trainer/assignments?link=${q(link)}`)
export const saveDraft = body => send('/api/trainer/assignments/draft', 'PUT', body)
export const publishDraft = body => send('/api/trainer/assignments/publish', 'POST', body)
export const getProgress = link => api(`/api/trainer/progress?link=${q(link)}`)

/** The client's side: its link and the current published revision. */
export const getMyAssignment = () => api('/api/trainer/assignment')
export const ackAssignment = ({ link, rev, outcome, routineIds }) => send('/api/trainer/assignment/ack', 'POST', { link, rev, outcome, routineIds })

/** Which of these files the client's own media folder lacks (upstream's POST /api/media/missing). */
export const missingMedia = hashes => send('/api/media/missing', 'POST', { hashes })
/** A demo file of the client's trainer, as a Blob (only while the link is active and a published
 *  revision names it). */
export const fetchTrainerDemo = (trainer, hash, size) => apiBlob(`/api/media/trainer?hash=${hash}&trainer=${q(trainer)}`, { expectSize: size })
/** A file into the client's own media folder, through upstream's own upload (PUT /api/media/<hash>). */
export const uploadOwnMedia = (hash, blob, mime) => apiUpload(`/api/media/${hash}`, blob, mime)

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

/* ---------- FIT-008: a quick session from the Coach (api/trainer/quick-session.js) ---------- */

export const getQuickSession = () => api('/api/trainer/quick-session')
export const askQuickSession = request => send('/api/trainer/quick-session', 'POST', request)
export const dropQuickSession = () => send('/api/trainer/quick-session', 'DELETE', {})

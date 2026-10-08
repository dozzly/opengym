// The client's side of plan delivery (ADR 029, decision 5; FIT-004), run by the always-mounted
// TrainerInbox: ask the server for the link's current published revision, and when it is newer
// than the one this profile last applied or discarded, apply it (trainer-managed) or offer it
// (co-managed). Applying is the client's own app changing its own profile through the store's
// update(), taken to the server by its own sync (PUT /api/data, with its revision): the server
// never writes a client's state.
//
//   check(uid)        GET /api/trainer/assignment; an acknowledgement still owed is sent first
//   apply(uid, a)     an undo copy, applySnapshot, the demo files copied, the acknowledgement
//   discard(uid, a)   the acknowledgement only: nothing in the profile changes
//   undo(u)           routines, week and reschedules put back as they were; acknowledged as
//                     discarded, so the trainer sees it was undone
//
// What applying changes is applySnapshot's: the routines this link delivered (replaced in place,
// keeping their ids, so history stays attached) and the trainer's exercises (added or updated,
// never removed). Never personal routines, workouts, weigh-ins or settings. Nor, in the MVP, the
// week or any schedule: a programme's week is not applied, and the client puts the delivered
// routines on days as it likes (deleteRoutine still takes a removed routine off the week).
//
// The undo copy is the module's own, in memory, not the Coach's snapshot stack: pushSnapshot and
// revertLast keep theirs in the Coach's namespace (the Coach's "Undo the last Coach changes" would
// then undo a trainer's plan, and revertLast writes a Coach message into its log). Like upstream's
// it covers routines and week (and the reschedules deleteRoutine drops); delivered exercises stay,
// as they do after a Coach revert.
//
// Demo files: each one a snapshot names and this profile's media folder lacks (upstream's POST
// /api/media/missing) is downloaded from the trainer's demo store, which serves it only while the
// link is active, and uploaded into the client's own folder through upstream's own upload. From
// then on it is the client's file: it outlives the link, the library and the trainer.
import { updateProfile, currentProfile } from './adapter.js'
import { applySnapshot } from './snapshot.js'
import { getMyAssignment, ackAssignment, missingMedia, fetchTrainerDemo, uploadOwnMedia } from './client.js'

export const POLL_MS = 60000

const clone = v => JSON.parse(JSON.stringify(v ?? null))
const PENDING = uid => `gym_trainer_ack_v1:${uid}`

/* ---------- an acknowledgement owed to the server (it failed to go; sent at the next check) ---------- */

function readPending(uid) {
  try { const v = JSON.parse(localStorage.getItem(PENDING(uid)) || 'null'); return v && typeof v === 'object' ? v : null } catch { return null }
}
function writePending(uid, ack) { try { localStorage.setItem(PENDING(uid), JSON.stringify(ack)) } catch { /* no room: sent again after the next apply */ } }
function dropPending(uid) { try { localStorage.removeItem(PENDING(uid)) } catch { /* nothing */ } }
// A refusal that will not change by sending again (the link ended, the revision is stale).
const final = e => e?.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429

async function sendAck(uid, ack) {
  writePending(uid, ack)
  try { const r = await ackAssignment(ack); dropPending(uid); return r?.applied || true }
  catch (e) { if (final(e)) dropPending(uid); return false }
}

/* ---------- the check ---------- */

/**
 * The client's assignment, as GET /api/trainer/assignment answers it, plus `due`: a published
 * revision newer than the one applied or discarded. `{ linked: false }` without a link.
 */
export async function check(uid) {
  const a = await getMyAssignment()
  if (!a || a.linked !== true) { dropPending(uid); return { linked: false } }
  const owed = readPending(uid)
  if (owed) {
    const newer = owed.link === a.link.id && (!a.applied || owed.rev > a.applied.rev || (owed.rev === a.applied.rev && owed.outcome !== a.applied.outcome))
    if (!newer) dropPending(uid)
    else {
      const r = await sendAck(uid, owed)
      if (!r) return { ...a, due: false }   // not through yet: nothing is applied again meanwhile
      if (typeof r === 'object') a.applied = r
    }
  }
  const p = a.published
  return { ...a, due: !!p && (!a.applied || p.rev > a.applied.rev) }
}

/* ---------- applying, discarding, undoing ---------- */

const undoCopy = s => ({ routines: clone(s.routines || []), week: clone(s.week || {}), dayPlan: clone(s.dayPlan || {}) })

/**
 * Applies `a.published` to the signed-in profile, copies its demo files, and acknowledges it.
 * Resolves { res, copy, acked, undo }; `undo` is for undo(). Throws applySnapshot's refusal
 * (id-collision, not-snapshot) before changing anything.
 */
export async function apply(uid, a) {
  const { link, published } = a
  const previousRoutineIds = a.applied?.routineIds || []
  let res, before
  updateProfile(s => {
    before = undoCopy(s)
    res = applySnapshot(s, published.snapshot, { previousRoutineIds })
  })
  const copy = await copyDemos(published.snapshot, link.trainer.id)
  const acked = await sendAck(uid, { link: link.id, rev: published.rev, outcome: 'applied', routineIds: res.routineIds })
  return { res, copy, acked, undo: { ...before, uid, link: link.id, rev: published.rev, previousRoutineIds } }
}

/** Says no to `a.published`: acknowledged as discarded; the profile is not touched. */
export function discard(uid, a) {
  return sendAck(uid, { link: a.link.id, rev: a.published.rev, outcome: 'discarded', routineIds: a.applied?.routineIds || [] })
}

/** Puts back what apply() replaced, and tells the server the revision was not kept. */
export function undo(u) {
  updateProfile(s => {
    s.routines = clone(u.routines)
    s.week = clone(u.week)
    s.dayPlan = clone(u.dayPlan)
  })
  return sendAck(u.uid, { link: u.link, rev: u.rev, outcome: 'discarded', routineIds: u.previousRoutineIds })
}

/** Whether a workout is running here: nothing is applied under it. */
export const workoutRunning = () => !!currentProfile()?.active

/* ---------- demo files ---------- */

/** The demo files (and posters) a snapshot names: hash → { mime, size }. */
export function demoFiles(snapshot) {
  const files = new Map()
  for (const c of snapshot?.customEx || []) {
    const m = c?.media
    if (!m || typeof m.hash !== 'string') continue
    files.set(m.hash, { mime: m.mime, size: m.size })
    if (m.poster && typeof m.poster.hash === 'string') files.set(m.poster.hash, { mime: m.poster.mime, size: m.poster.size })
  }
  return files
}

/**
 * Copies into the client's own media folder each demo file of `snapshot` it does not have yet.
 * Resolves { copied, present, failed, unavailable }; never throws. `unavailable`: this server
 * keeps no media (MEDIA_UPLOADS=0), so there is nothing to copy to.
 */
export async function copyDemos(snapshot, trainer) {
  const files = demoFiles(snapshot)
  const out = { copied: 0, present: 0, failed: 0, unavailable: false }
  if (!files.size) return out
  let missing
  try { missing = (await missingMedia([...files.keys()]))?.missing || [] }
  catch (e) {
    if (e?.status === 404) out.unavailable = true
    else out.failed = files.size
    return out
  }
  out.present = files.size - missing.length
  for (const hash of missing) {
    const f = files.get(hash)
    if (!f) continue
    try {
      const blob = await fetchTrainerDemo(trainer, hash, f.size)
      await uploadOwnMedia(hash, blob, f.mime)
      out.copied++
    } catch { out.failed++ }
  }
  return out
}

/* ---------- asking for a check from elsewhere in the module ---------- */

const listeners = new Set()
/** TrainerInbox listens; the trainer page asks after the client accepts or changes the mode. */
export const onCheckRequest = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export const requestCheck = () => { for (const fn of [...listeners]) fn() }

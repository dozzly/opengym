// The trainer module's one door into upstream's frontend (dozzly/opengym, ADR 029).
//
// Every store, lib and component internal the module uses is named here and nowhere else in
// src/trainer/, so an upstream change that moves or reshapes one of them has a single place to be
// fixed in. contract.test.js pins the behaviour of each one the module relies on, and of the
// upstream paths its data has to survive (store load, sync merge, the server's stamping, editing
// in RoutineEdit): a rebase onto a release that changed any of it fails there, by name, before an
// image is built.
//
// The rules the contract tests established (dozzly/README.md, "Data contract"):
//   - A field the module adds at the routine level or on a custom exercise (`assigned`) survives
//     loading, healing, unit conversion, the sync merge, the server's PUT /api/data stamping and
//     every RoutineEdit edit. It is the module's marker of what it delivered.
//   - A field on an exercise *inside* a routine does not survive editing that exercise
//     (RoutineEdit rebuilds the slot from the config sheet), so the module never keeps data there.
//   - copyRoutine copies the marker: a routine counts as delivered only when its id is also one
//     the module recorded, never by the marker alone.
//   - mergePlan mints fresh ids and drops unknown routine fields, so applying an assignment is the
//     module's own replace-in-place (stable ids, so history and progression stay attached),
//     built on parsePlan, pushSnapshot and deleteRoutine.
import { useStore } from '../store/useStore.js'

export { useStore, DEF } from '../store/useStore.js'
export { api } from '../lib/api.js'
export { parsePlan } from '../lib/plan-share.js'
export { pushSnapshot, revertLast, canRevert, SNAPSHOT_MAX } from '../lib/coach.js'
export { deleteRoutine } from '../lib/routines.js'
export { Section, Row } from '../components/ui.jsx'

/** The key the module keeps on a routine or custom exercise it delivered:
 *  `{ by, assignmentId, rev }` (and `exId`, the trainer's stable exercise id, on a custom one). */
export const ASSIGNED = 'assigned'

/** The signed-in user ({ id, name, admin }), or null for a guest or a signed-out device. */
export const useUser = () => useStore(s => s.user)

/** The profile as it stands now (the store's `S`). Read-only: change it through updateProfile. */
export const currentProfile = () => useStore.getState().S

/** Changes the profile through the store's own update: stamped for the merge, saved, and synced
 *  by the client's own revision machinery. The only way the module writes a client's data. */
export const updateProfile = mut => useStore.getState().update(mut)

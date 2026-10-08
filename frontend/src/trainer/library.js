// The trainer's library in the app: the same gate as the server's (api/trainer/library.js), so
// the editor can say what is wrong before anything is sent, plus what only the app can know: which
// built-in exercise a slot names, from the catalogue the app runs with.
//
// The validation mirrors the server's field for field (library.test.js runs both over the same
// inputs and wants the same answers). The server stays the authority; this is for the trainer's
// benefit. Pure: no store, no network.
//
//   exercise  { id: tx_…, rev, n, bp, eq, desc, primaries, secondaries, url?, media?, archived, … }
//   programme { id: tp_…, rev, name, unit, routines: [{ id: tr_…, name, emoji?, ex: [slot] }], week, … }
//   slot      { id: tx_…, sets?, reps?, … }  or  { id: <built-in id>, catalog: 'og1', sets?, … }
import { normalizeMediaRef, CATALOGUE } from './adapter.js'

export const LIMITS = Object.freeze({
  exercises: 500, programmes: 100, routines: 14, slots: 40, perDay: 6,
  name: 80, desc: 1000, word: 40, muscles: 16, note: 500, url: 2048, glyph: 40, sg: 24,
})

export const EX_ID_RE = /^tx_[0-9a-f]{16}$/
export const PROG_ID_RE = /^tp_[0-9a-f]{16}$/
export const ROUTINE_ID_RE = /^tr_[0-9a-f]{16}$/
export const UNITS = ['kg', 'lb']

/* ---------------------------------------------------------------- built-in exercises */

// Upstream's v1.4.0 replaces the built-in catalogue and its exercise ids, and migrates only the
// data it owns. A slot that names a built-in exercise therefore carries the catalogue it was picked
// from, and every reference goes through builtinRef() and resolveBuiltin() here (and builtinRef()
// in api/trainer/library.js): a later id mapping is an entry in CATALOGS and a few lines in
// resolveBuiltin, and an old id is never read as a new one.
//
// The server cannot see the catalogue; the app can. An og1 id is trusted only while the catalogue
// the app runs with is the one og1 names — the same ids, fingerprinted below — so a renumbered
// catalogue shows "unknown exercise" instead of the wrong exercise. contract.test.js fails the
// build the day upstream's catalogue stops matching, which is when a mapping is written (or, if
// upstream only added exercises, the new fingerprint is added to the list).
export const CATALOGS = Object.freeze({
  og1: { id: /^[0-9]{4}$/, fingerprints: ['1324:ee0a5fea'] },   // openGym 1.3.x, 1,324 exercises
})
export const CURRENT_CATALOG = 'og1'

/** { id, catalog } for a well-formed id of a catalogue this module knows, else null. */
export function builtinRef(id, catalog = CURRENT_CATALOG) {
  if (typeof id !== 'string' || typeof catalog !== 'string' || !Object.hasOwn(CATALOGS, catalog)) return null
  return CATALOGS[catalog].id.test(id) ? { id, catalog } : null
}

/** "<count>:<FNV-1a of the sorted ids>": which catalogue a list of built-in exercises is. */
export function catalogFingerprint(list) {
  const ids = list.map(e => e.id).sort().join(',')
  let h = 0x811c9dc5
  for (let i = 0; i < ids.length; i++) { h ^= ids.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return `${list.length}:${h.toString(16).padStart(8, '0')}`
}

const indexes = new WeakMap()   // catalogue list -> { fingerprint, byId }
function indexOf(list) {
  let ix = indexes.get(list)
  if (!ix) { ix = { fingerprint: catalogFingerprint(list), byId: new Map(list.map(e => [e.id, e])) }; indexes.set(list, ix) }
  return ix
}

/** The built-in exercise a reference names in `catalogue` (the app's own by default), or null:
 *  an id that is not in it, a catalogue this module does not know, or a catalogue that is not the
 *  one the reference was taken from. Never a custom exercise of the trainer's own profile. */
export function resolveBuiltin(ref, catalogue = CATALOGUE) {
  // A stored reference names its catalogue; one that does not is not taken for today's.
  if (!ref || typeof ref.catalog !== 'string' || !builtinRef(ref.id, ref.catalog)) return null
  const ix = indexOf(catalogue)
  if (!CATALOGS[ref.catalog].fingerprints.includes(ix.fingerprint)) return null
  return ix.byId.get(ref.id) || null
}

/** A built-in exercise by the id upstream's own data uses (a logged workout's entry, a routine in
 *  a profile): upstream's catalogue as this app runs it. Never for the module's stored references,
 *  which carry their catalogue and go through resolveBuiltin(). */
export const catalogueEntry = (id, catalogue = CATALOGUE) => (typeof id === 'string' ? indexOf(catalogue).byId.get(id) || null : null)

/** What a slot names: { kind: 'library', ex } (archived ones included), { kind: 'builtin', ex },
 *  or { kind: 'unknown', id, catalog } — shown as such, never dropped from the programme. */
export function resolveSlot(slot, exercisesById, catalogue = CATALOGUE) {
  const id = slot && slot.id
  if (typeof id === 'string' && EX_ID_RE.test(id)) {
    const ex = exercisesById.get(id)
    return ex ? { kind: 'library', ex } : { kind: 'unknown', id, catalog: null }
  }
  const ex = resolveBuiltin({ id, catalog: slot && slot.catalog }, catalogue)
  return ex ? { kind: 'builtin', ex } : { kind: 'unknown', id: typeof id === 'string' ? id : '', catalog: slot && typeof slot.catalog === 'string' ? slot.catalog : null }
}

/** A slot for a picked exercise: a library one by its id, a built-in one with its catalogue. */
export function slotFor(exercise, cfg = { sets: 3, reps: 10 }) {
  if (EX_ID_RE.test(exercise.id)) return { id: exercise.id, ...cfg }
  const ref = builtinRef(exercise.id)
  if (!ref) throw new LibraryError('invalid', 'id')
  return { id: ref.id, catalog: ref.catalog, ...cfg }
}

/* ---------------------------------------------------------------- validation */

export class LibraryError extends Error {
  constructor(code, field, extra = {}) {
    super(`${code}${field ? ': ' + field : ''}`)
    this.code = code
    this.field = field || null
    this.extra = extra
  }
}
const bad = field => { throw new LibraryError('invalid', field) }
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/
const ONE_LINE = /[\u0000-\u001f\u007f]/

function text(v, field, max, { required = false, multiline = false } = {}) {
  if (v == null) { if (required) bad(field); return '' }
  if (typeof v !== 'string') bad(field)
  const s = v.trim()
  if (required && !s) bad(field)
  if (s.length > max || (multiline ? CONTROL : ONE_LINE).test(s)) bad(field)
  return s
}
const word = (v, field, { required = false } = {}) => text(v, field, LIMITS.word, { required })
function wordList(v, field) {
  if (v == null) return []
  if (!Array.isArray(v) || v.length > LIMITS.muscles) bad(field)
  const out = []
  for (const m of v) {
    const w = word(m, field, { required: true })
    if (!out.includes(w)) out.push(w)
  }
  return out
}
function link(v) {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || v.length > LIMITS.url || /\s/.test(v)) bad('url')
  let u
  try { u = new URL(v) } catch { bad('url') }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) bad('url')
  return u.href.length <= LIMITS.url ? u.href : bad('url')
}

/** What the trainer may set on a library exercise, as the server will store it. Throws LibraryError. */
export function cleanExerciseInput(raw) {
  if (!isObj(raw)) bad('exercise')
  const n = text(raw.n, 'n', LIMITS.name, { required: true })
  const bp = word(raw.bp, 'bp', { required: true })
  const eq = word(raw.eq, 'eq')
  const desc = text(raw.desc, 'desc', LIMITS.desc, { multiline: true })
  const primaries = wordList(raw.primaries, 'primaries')
  const secondaries = wordList(raw.secondaries, 'secondaries').filter(m => !primaries.includes(m))
  const out = { n, bp, eq, desc, primaries, secondaries }
  const url = link(raw.url)
  if (url) out.url = url
  if (raw.media != null) {
    const media = normalizeMediaRef(raw.media)
    if (!media) bad('media')
    out.media = media
  }
  return out
}

const SLOT_NUMBERS = {
  sets: { int: true, min: 1, max: 20 },
  reps: { int: true, min: 1, max: 999 },
  repsMin: { int: true, min: 1, max: 999 },
  weight: { min: 0, max: 2000 },
  sec: { int: true, min: 1, max: 36000 },
  min: { min: 0.5, max: 1440 },
  speed: { min: 0, max: 100 },
  restSec: { int: true, min: 0, max: 3600 },
  warmupSets: { int: true, min: 0, max: 5 },
}
const SLOT_FLAGS = ['side', 'bodyweight']
const SG_RE = /^[A-Za-z0-9_-]{1,24}$/
const GLYPH_RE = /^[A-Za-z0-9_-]{1,40}$/
const DAYS = ['0', '1', '2', '3', '4', '5', '6']

function cleanSlot(raw, field, exercises, allowArchived) {
  if (!isObj(raw) || typeof raw.id !== 'string') bad(field)
  const id = raw.id
  let out
  if (EX_ID_RE.test(id)) {
    const ex = exercises.get(id)
    if (!ex) throw new LibraryError('unknown-exercise', field, { id })
    if (ex.archived && !(allowArchived === true || allowArchived?.has?.(id))) throw new LibraryError('archived-exercise', field, { id })
    out = { id }
  } else {
    const ref = builtinRef(id, raw.catalog == null ? CURRENT_CATALOG : raw.catalog)
    if (!ref) bad(field)
    out = { id: ref.id, catalog: ref.catalog }
  }
  for (const [k, r] of Object.entries(SLOT_NUMBERS)) {
    const v = raw[k]
    if (v == null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < r.min || v > r.max || (r.int && !Number.isInteger(v))) bad(`${field}.${k}`)
    out[k] = r.int ? v : Math.round(v * 100) / 100
  }
  if (out.repsMin != null && (out.reps == null || out.repsMin >= out.reps)) bad(`${field}.repsMin`)
  if (raw.mode != null) {
    if (raw.mode !== 'reps' && raw.mode !== 'time') bad(`${field}.mode`)
    out.mode = raw.mode
  }
  for (const k of SLOT_FLAGS) {
    if (raw[k] == null) continue
    if (typeof raw[k] !== 'boolean') bad(`${field}.${k}`)
    out[k] = raw[k]
  }
  if (raw.sg != null) {
    if (typeof raw.sg !== 'string' || !SG_RE.test(raw.sg)) bad(`${field}.sg`)
    out.sg = raw.sg
  }
  const note = text(raw.note, `${field}.note`, LIMITS.note, { multiline: true })
  if (note) out.note = note
  return out
}

/** A routine id in the server's form, minted here so the week can name a routine not saved yet. */
export function newRoutineId() {
  const b = new Uint8Array(8)
  globalThis.crypto.getRandomValues(b)
  return 'tr_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

/** What the trainer may set on a programme, as the server will store it (see the server's for the
 *  rules on archived exercises and routine ids). Throws LibraryError. */
export function cleanProgrammeInput(raw, { exercises = new Map(), allowArchived = null } = {}) {
  if (!isObj(raw)) bad('programme')
  const name = text(raw.name, 'name', LIMITS.name, { required: true })
  const unit = raw.unit == null ? 'kg' : raw.unit
  if (!UNITS.includes(unit)) bad('unit')
  if (!Array.isArray(raw.routines)) bad('routines')
  if (raw.routines.length > LIMITS.routines) throw new LibraryError('too-many', 'routines', { max: LIMITS.routines })
  const ids = new Map()
  const routines = raw.routines.map((r, i) => {
    const field = `routines.${i}`
    if (!isObj(r)) bad(field)
    const keep = typeof r.id === 'string' && ROUTINE_ID_RE.test(r.id) && ![...ids.values()].includes(r.id)
    const id = keep ? r.id : newRoutineId()
    if (typeof r.id === 'string' && !ids.has(r.id)) ids.set(r.id, id)
    const routine = { id, name: text(r.name, `${field}.name`, LIMITS.name, { required: true }) }
    if (r.emoji != null) {
      if (typeof r.emoji !== 'string' || !GLYPH_RE.test(r.emoji)) bad(`${field}.emoji`)
      routine.emoji = r.emoji
    }
    if (!Array.isArray(r.ex)) bad(`${field}.ex`)
    if (r.ex.length > LIMITS.slots) throw new LibraryError('too-many', `${field}.ex`, { max: LIMITS.slots })
    routine.ex = r.ex.map((s, j) => cleanSlot(s, `${field}.ex.${j}`, exercises, allowArchived))
    return routine
  })
  const week = {}
  if (raw.week != null) {
    if (!isObj(raw.week)) bad('week')
    const known = new Set(routines.map(r => r.id))
    for (const [d, v] of Object.entries(raw.week)) {
      if (!DAYS.includes(d)) bad('week')
      const list = [].concat(v)
      if (list.length > LIMITS.perDay) bad(`week.${d}`)
      const out = []
      for (const rid of list) {
        const id = typeof rid === 'string' ? ids.get(rid) : undefined
        if (!id || !known.has(id)) bad(`week.${d}`)
        if (!out.includes(id)) out.push(id)
      }
      if (out.length) week[d] = out
    }
  }
  return { name, unit, routines, week }
}

/** The library exercise ids a programme's slots name. */
export const programmeExerciseIds = p => new Set((p.routines || []).flatMap(r => (r.ex || []).map(s => s.id)).filter(id => EX_ID_RE.test(id)))

export const byId = list => new Map((list || []).map(x => [x.id, x]))

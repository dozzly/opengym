/* The trainer's library as data (dozzly/opengym, ADR 029, roadmap FIT-003): what a library
 * exercise and a programme are, how big each may get, and the one gate every write, every read of
 * the file and every export passes through. Pure: no I/O, no clock of its own.
 *
 *   library   { v: 1, rev, wid, exercises: [exercise], programmes: [programme] }
 *   exercise  { id: tx_<16 hex>, rev, n, bp, eq, desc, primaries, secondaries, url?, media?,
 *               archived, createdAt, updatedAt }
 *   programme { id: tp_<16 hex>, rev, name, unit, routines: [routine], week,
 *               archived, createdAt, updatedAt }
 *   routine   { id: tr_<16 hex>, name, emoji?, ex: [slot] }       (upstream's routine shape)
 *   slot      { id: tx_…, sets?, reps?, … }                         a library exercise, or
 *             { id: <built-in id>, catalog: 'og1', sets?, … }       an upstream built-in one;
 *             either may carry `note` (instructions), and `run` (a run, run.js) or `climb` (a
 *             climbing session, climb.js)
 *
 * An exercise's content is upstream's custom-exercise shape as far as it applies (name `n`, body
 * part `bp`, equipment `eq`, instructions `desc`, muscles, link `url`, and a MediaRef `media`), so
 * the app can later snapshot it into a client's customEx unchanged (frontend/src/trainer/
 * snapshot.js). Everything that comes in is rebuilt from the fields named here: unknown fields are
 * dropped, every string and list is bounded, and a value out of range is refused, not clamped, so
 * the trainer's app learns about it. frontend/src/trainer/library.js is this file's mirror for the
 * app, and its test runs both over the same inputs.
 */
import crypto from 'node:crypto';
import { HASH_RE, MEDIA_TYPES } from '../media.js';
import { inOg1 } from './catalog-og1.js';
import { RunError, cleanRun, deliveredNote } from './run.js';
import { ClimbError, cleanClimb, climbNote } from './climb.js';

export const LIBRARY_FORMAT = 1;
export const EXPORT_FORMAT = 1;

export const LIMITS = Object.freeze({
  exercises: 500,     // per trainer, archived ones included
  programmes: 100,
  routines: 14,       // per programme
  slots: 40,          // exercises per routine
  perDay: 6,          // routines on one weekday
  name: 80,           // upstream's custom-exercise name field (maxLength 80)
  desc: 1000,         // upstream's custom-exercise description (maxLength 1000)
  word: 40,           // a body part, an equipment or a muscle name
  muscles: 16,
  note: 500,          // upstream's NOTE_MAX
  url: 2048,          // upstream's cleanUrl
  glyph: 40,
  sg: 24
});

export const EX_ID_RE = /^tx_[0-9a-f]{16}$/;
export const PROG_ID_RE = /^tp_[0-9a-f]{16}$/;
export const ROUTINE_ID_RE = /^tr_[0-9a-f]{16}$/;

/* ---------------------------------------------------------------- built-in exercises */

// Upstream's v1.4.0 replaces the built-in catalogue, and its exercise ids change. Upstream migrates
// the data it owns on first start, and nothing under DATA_DIR/trainer/. So a slot that names a
// built-in exercise also names the catalogue the id was taken from, and every such reference goes
// through builtinRef(): a later id-mapping migration is a new entry here and a mapping in that one
// function, and old ids stay recognisable as old. `og1` is the catalogue of openGym 1.3.x (1,324
// exercises, four-digit ids, frontend/src/lib/exercises-data.js); the app checks the catalogue it
// runs with is still that one (frontend/src/trainer/library.js) before it trusts an og1 id, and
// contract.test.js fails the build when upstream's catalogue stops being it. The server has no
// catalogue and checks the form only.
export const CATALOGS = Object.freeze({ og1: /^[0-9]{4}$/ });
export const CURRENT_CATALOG = 'og1';

/** A reference to an upstream built-in exercise, { id, catalog }, or null when `id` is not a
 *  well-formed id of that catalogue (or the catalogue is not one this module knows). */
export function builtinRef(id, catalog = CURRENT_CATALOG) {
  if (typeof id !== 'string' || typeof catalog !== 'string' || !Object.hasOwn(CATALOGS, catalog)) return null;
  return CATALOGS[catalog].test(id) ? { id, catalog } : null;
}

// Which ids each catalogue holds: the server's stand-in for the catalogue the app resolves against
// (resolveBuiltin in frontend/src/trainer/library.js). Used when the server builds the snapshot it
// publishes (snapshot.js), so a slot naming an id its catalogue does not have is caught there.
const MEMBERS = Object.freeze({ og1: inOg1 });

/** The built-in exercise a stored reference ({ id, catalog }) names, as { id, catalog }, or null:
 *  no catalogue named, one this module does not know, an id not of its form, or not in it. */
export function resolveBuiltin(ref) {
  if (!ref || typeof ref.catalog !== 'string') return null;
  const r = builtinRef(ref.id, ref.catalog);
  return r && MEMBERS[r.catalog](r.id) ? r : null;
}

export const newId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
export const newWid = () => crypto.randomBytes(8).toString('hex');

/** A refusal of something the trainer's app sent: `code` says what kind, `field` where. */
export class LibraryError extends Error {
  constructor(code, field, extra = {}) {
    super(`${code}${field ? ': ' + field : ''}`);
    this.code = code;
    this.field = field || null;
    this.extra = extra;
  }
}
const bad = field => { throw new LibraryError('invalid', field); };

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// No control characters: a name is one line, and nothing here is ever HTML.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const ONE_LINE = /[\u0000-\u001f\u007f]/;

function text(v, field, max, { required = false, multiline = false } = {}) {
  if (v == null) { if (required) bad(field); return ''; }
  if (typeof v !== 'string') bad(field);
  const s = v.trim();
  if (required && !s) bad(field);
  if (s.length > max || (multiline ? CONTROL : ONE_LINE).test(s)) bad(field);
  return s;
}
const word = (v, field, { required = false } = {}) => text(v, field, LIMITS.word, { required });

/** A note of the trainer's (a slot's, an assignment's): at most 500 characters, line breaks
 *  allowed, trimmed; '' for none. Throws LibraryError. */
export const cleanNote = (v, field = 'note') => text(v, field, LIMITS.note, { multiline: true });

function wordList(v, field) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > LIMITS.muscles) bad(field);
  const out = [];
  for (const m of v) {
    const w = word(m, field, { required: true });
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/* ---------------------------------------------------------------- MediaRef */

// The same gate as the app's normalizeMediaRef (frontend/src/lib/media-refs.js), field for field:
// a ref the app would show as "no media" is refused here. The type table is api/media.js's, so a
// ref can only name a type the media store would ever have stored.
const MB = 1024 * 1024;
const MAX_SIZE = 200 * MB;
const MAX_EDGE = 16384;
const MAX_DUR = 3600;
const POSTER_MIMES = new Set(['image/webp', 'image/jpeg']);
const CODECS = ['avc1', 'hvc1', 'av01', 'vp09', 'vp8', 'vp9', 'other'];
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function cleanPoster(p) {
  if (!isObj(p)) return null;
  if (typeof p.hash !== 'string' || !HASH_RE.test(p.hash)) return null;
  if (!POSTER_MIMES.has(p.mime)) return null;
  if (!intIn(p.size, 1, MAX_SIZE) || !intIn(p.width, 1, MAX_EDGE) || !intIn(p.height, 1, MAX_EDGE)) return null;
  return { hash: p.hash, mime: p.mime, size: p.size, width: p.width, height: p.height };
}

/** A MediaRef rebuilt from its known fields, or null: upstream's normalizeMediaRef on the server. */
export function cleanMediaRef(ref) {
  if (!isObj(ref)) return null;
  const type = typeof ref.mime === 'string' && Object.hasOwn(MEDIA_TYPES, ref.mime) ? MEDIA_TYPES[ref.mime] : null;
  if (!type || ref.kind !== type.kind) return null;
  if (typeof ref.hash !== 'string' || !HASH_RE.test(ref.hash)) return null;
  if (!intIn(ref.size, 1, MAX_SIZE) || !intIn(ref.width, 1, MAX_EDGE) || !intIn(ref.height, 1, MAX_EDGE)) return null;
  const out = { kind: ref.kind, hash: ref.hash, mime: ref.mime, size: ref.size, width: ref.width, height: ref.height };
  if (ref.dur != null) {
    if (typeof ref.dur !== 'number' || !Number.isFinite(ref.dur) || ref.dur < 0 || ref.dur > MAX_DUR) return null;
    out.dur = Math.round(ref.dur * 10) / 10;
  }
  if (ref.codec != null) {
    if (ref.kind !== 'video' || !CODECS.includes(ref.codec)) return null;
    out.codec = ref.codec;
  }
  const poster = cleanPoster(ref.poster);
  if (poster) out.poster = poster;
  out.at = typeof ref.at === 'number' && Number.isFinite(ref.at) && ref.at > 0 ? Math.round(ref.at) : 0;
  return out;
}

/** The blob hashes an exercise's media names: the file and its poster. */
export const mediaHashes = media => (media ? [media.hash, ...(media.poster ? [media.poster.hash] : [])] : []);

/* ---------------------------------------------------------------- links */

/** An http(s) link with a host and no credentials, at most 2048 characters, or a refusal. The
 *  app runs upstream's cleanUrl first (which adds https:// to a bare host); this only checks. */
function link(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > LIMITS.url || /\s/.test(v)) bad('url');
  let u;
  try { u = new URL(v); } catch { bad('url'); }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) bad('url');
  return u.href.length <= LIMITS.url ? u.href : bad('url');
}

/* ---------------------------------------------------------------- exercises */

export const EXERCISE_CONTENT = ['n', 'bp', 'eq', 'desc', 'primaries', 'secondaries', 'url', 'media'];

/** What the trainer may set on a library exercise, validated and rebuilt. Throws LibraryError. */
export function cleanExerciseInput(raw) {
  if (!isObj(raw)) bad('exercise');
  const n = text(raw.n, 'n', LIMITS.name, { required: true });
  const bp = word(raw.bp, 'bp', { required: true });
  const eq = word(raw.eq, 'eq');
  const desc = text(raw.desc, 'desc', LIMITS.desc, { multiline: true });
  const primaries = wordList(raw.primaries, 'primaries');
  const secondaries = wordList(raw.secondaries, 'secondaries').filter(m => !primaries.includes(m));
  const out = { n, bp, eq, desc, primaries, secondaries };
  const url = link(raw.url);
  if (url) out.url = url;
  if (raw.media != null) {
    const media = cleanMediaRef(raw.media);
    if (!media) bad('media');
    out.media = media;
  }
  return out;
}

const contentOf = (obj, keys) => JSON.stringify(keys.map(k => obj[k] ?? null));
export const sameExerciseContent = (a, b) => contentOf(a, EXERCISE_CONTENT) === contentOf(b, EXERCISE_CONTENT);

/** A stored exercise in its fixed field order. */
export function exerciseRecord({ id, rev, archived, createdAt, updatedAt }, content) {
  const { n, bp, eq, desc, primaries, secondaries, url, media } = content;
  return {
    id, rev, n, bp, eq, desc, primaries, secondaries,
    ...(url ? { url } : {}), ...(media ? { media } : {}),
    archived: !!archived, createdAt, updatedAt
  };
}

/* ---------------------------------------------------------------- programmes */

// The slot fields a programme keeps: upstream's routine-exercise config (frontend/src/lib/
// history.js defaultConfig, plan-share.js cleanEx) without progression rules, which belong to the
// client's own training. Numbers out of range are refused rather than clamped.
const SLOT_NUMBERS = {
  sets: { int: true, min: 1, max: 20 },
  reps: { int: true, min: 1, max: 999 },
  repsMin: { int: true, min: 1, max: 999 },
  weight: { min: 0, max: 2000 },
  sec: { int: true, min: 1, max: 36000 },
  min: { min: 0.5, max: 1440 },
  speed: { min: 0, max: 100 },
  restSec: { int: true, min: 0, max: 3600 },
  warmupSets: { int: true, min: 0, max: 5 }
};
const SLOT_FLAGS = ['side', 'bodyweight'];
const SG_RE = /^[A-Za-z0-9_-]{1,24}$/;
const GLYPH_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const UNITS = ['kg', 'lb'];
const DAYS = ['0', '1', '2', '3', '4', '5', '6'];

function cleanSlot(raw, field, exercises, allowArchived) {
  if (!isObj(raw) || typeof raw.id !== 'string') bad(field);
  const id = raw.id;
  let out;
  if (EX_ID_RE.test(id)) {
    const ex = exercises.get(id);
    if (!ex) throw new LibraryError('unknown-exercise', field, { id });
    if (ex.archived && !(allowArchived === true || allowArchived?.has?.(id))) throw new LibraryError('archived-exercise', field, { id });
    out = { id };
  } else {
    // A slot without a catalogue was picked from the one the app runs with now.
    const ref = builtinRef(id, raw.catalog == null ? CURRENT_CATALOG : raw.catalog);
    if (!ref) bad(field);
    out = { id: ref.id, catalog: ref.catalog };
  }
  for (const [k, r] of Object.entries(SLOT_NUMBERS)) {
    const v = raw[k];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < r.min || v > r.max || (r.int && !Number.isInteger(v))) bad(`${field}.${k}`);
    out[k] = r.int ? v : Math.round(v * 100) / 100;
  }
  if (out.repsMin != null && (out.reps == null || out.repsMin >= out.reps)) bad(`${field}.repsMin`);
  if (raw.mode != null) {
    if (raw.mode !== 'reps' && raw.mode !== 'time') bad(`${field}.mode`);
    out.mode = raw.mode;
  }
  for (const k of SLOT_FLAGS) {
    if (raw[k] == null) continue;
    if (typeof raw[k] !== 'boolean') bad(`${field}.${k}`);
    out[k] = raw[k];
  }
  if (raw.sg != null) {
    if (typeof raw.sg !== 'string' || !SG_RE.test(raw.sg)) bad(`${field}.sg`);
    out.sg = raw.sg;
  }
  const note = text(raw.note, `${field}.note`, LIMITS.note, { multiline: true });
  if (note) out.note = note;
  // A structured run (FIT-009, run.js). The client gets its text and the note in one note, which
  // has to fit upstream's NOTE_MAX.
  if (raw.run != null) {
    let run;
    try { run = cleanRun(raw.run, `${field}.run`); } catch (e) { if (e instanceof RunError) bad(e.field); throw e; }
    if (deliveredNote(run, note).length > LIMITS.note) throw new LibraryError('too-long', `${field}.run`, { max: LIMITS.note });
    out.run = run;
  }
  // A climbing session (FIT-010, climb.js): the same, and a slot has a run or a session, not both.
  if (raw.climb != null) {
    if (out.run) bad(`${field}.climb`);
    let climb;
    try { climb = cleanClimb(raw.climb, `${field}.climb`); } catch (e) { if (e instanceof ClimbError) bad(e.field); throw e; }
    if (climbNote(climb, note).length > LIMITS.note) throw new LibraryError('too-long', `${field}.climb`, { max: LIMITS.note });
    out.climb = climb;
  }
  return out;
}

/**
 * What the trainer may set on a programme, validated and rebuilt. `exercises` is the library's
 * exercises by id: a slot naming a library exercise must name one that exists and is not
 * archived. `allowArchived` (a Set of ids, or true) lets through archived exercises the stored
 * programme already used, so archiving an exercise never makes the programmes that use it
 * unsaveable. A routine keeps its id when it is a well-formed one not used twice; otherwise it
 * gets a new one, and the week follows. Throws LibraryError.
 */
export function cleanProgrammeInput(raw, { exercises = new Map(), allowArchived = null } = {}) {
  if (!isObj(raw)) bad('programme');
  const name = text(raw.name, 'name', LIMITS.name, { required: true });
  const unit = raw.unit == null ? 'kg' : raw.unit;
  if (!UNITS.includes(unit)) bad('unit');
  if (!Array.isArray(raw.routines)) bad('routines');
  if (raw.routines.length > LIMITS.routines) throw new LibraryError('too-many', 'routines', { max: LIMITS.routines });
  const ids = new Map();
  const routines = raw.routines.map((r, i) => {
    const field = `routines.${i}`;
    if (!isObj(r)) bad(field);
    const keep = typeof r.id === 'string' && ROUTINE_ID_RE.test(r.id) && ![...ids.values()].includes(r.id);
    const id = keep ? r.id : newId('tr');
    if (typeof r.id === 'string' && !ids.has(r.id)) ids.set(r.id, id);
    const routine = { id, name: text(r.name, `${field}.name`, LIMITS.name, { required: true }) };
    if (r.emoji != null) {
      if (typeof r.emoji !== 'string' || !GLYPH_RE.test(r.emoji)) bad(`${field}.emoji`);
      routine.emoji = r.emoji;
    }
    if (!Array.isArray(r.ex)) bad(`${field}.ex`);
    if (r.ex.length > LIMITS.slots) throw new LibraryError('too-many', `${field}.ex`, { max: LIMITS.slots });
    routine.ex = r.ex.map((s, j) => cleanSlot(s, `${field}.ex.${j}`, exercises, allowArchived));
    return routine;
  });
  const week = {};
  if (raw.week != null) {
    if (!isObj(raw.week)) bad('week');
    const known = new Set(routines.map(r => r.id));
    for (const [d, v] of Object.entries(raw.week)) {
      if (!DAYS.includes(d)) bad('week');
      const list = [].concat(v);
      if (list.length > LIMITS.perDay) bad(`week.${d}`);
      const out = [];
      for (const rid of list) {
        const id = typeof rid === 'string' ? ids.get(rid) : undefined;
        if (!id || !known.has(id)) bad(`week.${d}`);
        if (!out.includes(id)) out.push(id);
      }
      if (out.length) week[d] = out;
    }
  }
  return { name, unit, routines, week };
}

export const PROGRAMME_CONTENT = ['name', 'unit', 'routines', 'week'];
export const sameProgrammeContent = (a, b) => contentOf(a, PROGRAMME_CONTENT) === contentOf(b, PROGRAMME_CONTENT);

export function programmeRecord({ id, rev, archived, createdAt, updatedAt }, { name, unit, routines, week }) {
  return { id, rev, name, unit, routines, week, archived: !!archived, createdAt, updatedAt };
}

/** The library exercise ids a programme's slots name. */
export const programmeExerciseIds = p => new Set((p.routines || []).flatMap(r => r.ex.map(s => s.id)).filter(id => EX_ID_RE.test(id)));

/* ---------------------------------------------------------------- the whole library */

export const emptyLibrary = () => ({ v: LIBRARY_FORMAT, rev: 0, wid: null, exercises: [], programmes: [] });

const stamp = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : bad('stamp'));
const counter = v => (Number.isInteger(v) && v >= 1 ? v : bad('rev'));

/**
 * Exercises and programmes as a stored file or an export holds them, every one through the same
 * gates as a write. Archived exercises may be referenced (they were valid when saved). Throws
 * LibraryError on anything that is not one.
 */
export function cleanLists(rawExercises, rawProgrammes) {
  if (!Array.isArray(rawExercises) || !Array.isArray(rawProgrammes)) bad('library');
  if (rawExercises.length > LIMITS.exercises) throw new LibraryError('too-many', 'exercises', { max: LIMITS.exercises });
  if (rawProgrammes.length > LIMITS.programmes) throw new LibraryError('too-many', 'programmes', { max: LIMITS.programmes });
  const exercises = new Map();
  for (const e of rawExercises) {
    if (!isObj(e) || typeof e.id !== 'string' || !EX_ID_RE.test(e.id) || exercises.has(e.id)) bad('exercises');
    if (e.archived != null && typeof e.archived !== 'boolean') bad('exercises');
    exercises.set(e.id, exerciseRecord(
      { id: e.id, rev: counter(e.rev), archived: e.archived, createdAt: stamp(e.createdAt), updatedAt: stamp(e.updatedAt) },
      cleanExerciseInput(e)));
  }
  const seen = new Set();
  const programmes = rawProgrammes.map(p => {
    if (!isObj(p) || typeof p.id !== 'string' || !PROG_ID_RE.test(p.id) || seen.has(p.id)) bad('programmes');
    if (p.archived != null && typeof p.archived !== 'boolean') bad('programmes');
    seen.add(p.id);
    const content = cleanProgrammeInput(p, { exercises, allowArchived: true });
    // A stored routine id that had to be replaced means the file was not one this module wrote.
    if (content.routines.some((r, i) => r.id !== p.routines[i].id)) bad('programmes');
    return programmeRecord({ id: p.id, rev: counter(p.rev), archived: p.archived, createdAt: stamp(p.createdAt), updatedAt: stamp(p.updatedAt) }, content);
  });
  return { exercises: [...exercises.values()], programmes };
}

/** A library file's parsed JSON as a library, or a LibraryError when it is not one. */
export function cleanStoredLibrary(raw) {
  if (!isObj(raw) || raw.v !== LIBRARY_FORMAT || !Number.isInteger(raw.rev) || raw.rev < 0) bad('library');
  if (raw.wid != null && (typeof raw.wid !== 'string' || !/^[0-9a-f]{16}$/.test(raw.wid))) bad('library');
  const { exercises, programmes } = cleanLists(raw.exercises, raw.programmes);
  return { v: LIBRARY_FORMAT, rev: raw.rev, wid: raw.wid || null, exercises, programmes };
}

/**
 * The portable copy (GET /api/trainer/library/export): every exercise and programme, archived ones
 * included, with their media refs and no bytes. No account id: it is the trainer's own work, and
 * where it came from is nobody else's business.
 */
export function exportLibrary(doc, { now = Date.now(), module = '' } = {}) {
  return {
    opengym_trainer_library: EXPORT_FORMAT,
    module,
    exported: new Date(now).toISOString(),
    exercises: doc.exercises,
    programmes: doc.programmes
  };
}

/** An export read back: { exercises, programmes }, through the same gates as the stored file. */
export function parseExport(raw) {
  let data = raw;
  if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch { bad('export'); } }
  if (!isObj(data) || data.opengym_trainer_library !== EXPORT_FORMAT) bad('export');
  return cleanLists(data.exercises, data.programmes);
}

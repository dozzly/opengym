/* The durable snapshot of a trainer's programme, built on the server when the trainer publishes
 * (ADR 029, decision 5; FIT-004). A port of snapshotProgramme() and customExOf() in
 * frontend/src/trainer/snapshot.js: the server never takes a snapshot a client sent, it builds the
 * one it publishes from the trainer's own library, and the app's copy stays for the trainer's
 * preview. frontend/src/trainer/snapshot-parity.test.js runs both over the same libraries and
 * wants byte-identical JSON, the way upstream's coach-parity test pins the Coach's server copies.
 *
 *   { trainer_snapshot: 1, opengym_plan: 1, trainer, programme: { id, rev }, name, unit,
 *     routines, customEx, week, unresolved }
 *
 * - `routines` are upstream-shaped, each carrying the marker `assigned: { by, assignmentId, rev }`.
 *   A slot naming a library exercise keeps its tx_ id; one naming a built-in exercise keeps the
 *   catalogue it was taken from (`catalog: 'og1'`), so the client's app resolves it against the
 *   catalogue it runs and never reads an old id as a new one (library.js resolveBuiltin).
 * - `customEx` holds every library exercise the routines use, archived ones included, as a full
 *   custom exercise under its stable tx_ id: `custom: true`, its MediaRef, `src: { trainer, exRev }`.
 * - `unresolved` lists slots that cannot be delivered ({ routine, index, id, catalog }): a library
 *   exercise that is not in the library, or a built-in id its catalogue does not hold. Publishing
 *   refuses a snapshot with any.
 * A deep copy: later library edits never reach a snapshot already taken.
 */
import { EX_ID_RE, resolveBuiltin } from './library.js';

export const SNAPSHOT_FORMAT = 1;

const clone = v => JSON.parse(JSON.stringify(v));
const fail = (code, message) => Object.assign(new Error(message), { code });

/** A library exercise as a client's custom exercise: upstream's CustomExForm shape, plus `src`. */
export function customExOf(ex, trainer) {
  const primaries = [...(ex.primaries || [])];
  const secondaries = [...(ex.secondaries || [])];
  return {
    id: ex.id, n: ex.n, bp: ex.bp, eq: ex.eq || '', desc: ex.desc || '',
    tg: primaries[0] || '', primaries, secondaries, sm: [...secondaries], muscleGroups: [...primaries, ...secondaries],
    ...(ex.url ? { url: ex.url } : {}),
    ...(ex.media ? { media: clone(ex.media) } : {}),
    custom: true,
    src: { trainer, exRev: ex.rev }
  };
}

/** The snapshot of programme `programmeId` of `library` (a stored library), as published. */
export function snapshotProgramme(library, programmeId, { trainer = library?.owner, assignmentId, rev } = {}) {
  if (!trainer) throw fail('no-trainer', 'whose library this is must be known');
  const p = (library?.programmes || []).find(x => x.id === programmeId);
  if (!p) throw fail('not-found', 'no such programme');
  const exercises = new Map((library.exercises || []).map(e => [e.id, e]));
  const used = [];
  const unresolved = [];
  const routines = p.routines.map(r => {
    const ex = [];
    r.ex.forEach((slot, index) => {
      const { id, catalog, ...cfg } = slot;
      if (EX_ID_RE.test(id)) {
        const lib = exercises.get(id);
        if (!lib) { unresolved.push({ routine: r.id, index, id, catalog: null }); return; }
        if (!used.includes(lib)) used.push(lib);
        ex.push({ id, ...cfg });
        return;
      }
      const builtin = resolveBuiltin({ id, catalog });
      if (!builtin) { unresolved.push({ routine: r.id, index, id, catalog: catalog ?? null }); return; }
      ex.push({ id: builtin.id, catalog, ...cfg });
    });
    return {
      id: r.id, name: r.name, ...(r.emoji ? { emoji: r.emoji } : {}),
      assigned: { by: trainer, assignmentId: assignmentId || p.id, rev: rev ?? p.rev },
      ex
    };
  });
  return clone({
    trainer_snapshot: SNAPSHOT_FORMAT, opengym_plan: 1,
    trainer, programme: { id: p.id, rev: p.rev }, name: p.name, unit: p.unit,
    routines, customEx: used.map(e => customExOf(e, trainer)), week: p.week || {}, unresolved
  });
}

/** The blob hashes a snapshot's custom exercises name (each demo file and its poster). */
export function snapshotHashes(snapshot) {
  const out = new Set();
  for (const c of snapshot?.customEx || []) {
    const m = c?.media;
    if (m && typeof m.hash === 'string') out.add(m.hash);
    if (m?.poster && typeof m.poster.hash === 'string') out.add(m.poster.hash);
  }
  return out;
}

/** The routine ids a snapshot delivers. */
export const snapshotRoutineIds = snapshot => (snapshot?.routines || []).map(r => r.id);

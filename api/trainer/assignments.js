/* What a trainer assigns to one linked client (FIT-004): a draft, the published revisions, and the
 * client's acknowledgement of the last one it applied or discarded.
 *
 *   DATA_DIR/trainer/assignments/<linkId>.json
 *   { v: 1, rev, wid,
 *     draft:     { programmeId, note } | null,
 *     published: [{ rev, at, programmeId, programmeRev, snapshot, note }],   the last ten, oldest first
 *     applied:   { rev, at, outcome: 'applied' | 'discarded', routineIds } | null }
 *
 * - `rev`/`wid` count the trainer's writes (draft, publish), with PUT /api/data's semantics: a
 *   write names the revision it was based on and a stale one is a 409. The client's
 *   acknowledgement does not move them: it touches only `applied`, which no trainer write
 *   touches, so a trainer is never refused because the client applied something meanwhile.
 * - A published revision's `rev` is its own counter, 1, 2, 3, …, which the client compares with
 *   `applied.rev`. Its `snapshot` is built by the server from the trainer's library (snapshot.js).
 * - `applied.routineIds` are the routines the client's app holds for this link after applying: the
 *   ones it replaces at the next revision, and with every published snapshot's, the routines whose
 *   workouts the trainer may read (progress.js).
 *
 * The file is removed when the link ends; the client keeps what it applied, in its own profile.
 * One that cannot be read is never replaced (503) and keeps every demo file it names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, UNREADABLE } from './store.js';
import { newWid } from './library.js';
import { LINK_ID_RE } from './links.js';
import { snapshotRoutineIds } from './snapshot.js';

export const ASSIGNMENT_FORMAT = 1;
export const KEEP_PUBLISHED = 10;
export const OUTCOMES = Object.freeze(['applied', 'discarded']);

export const emptyAssignment = () => ({ v: ASSIGNMENT_FORMAT, rev: 0, wid: null, draft: null, published: [], applied: null });

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** An assignment file's parsed JSON as one, or UNREADABLE when it is not one this module wrote. */
export function cleanStoredAssignment(raw) {
  if (!isObj(raw) || raw.v !== ASSIGNMENT_FORMAT || !Number.isInteger(raw.rev) || raw.rev < 0) return UNREADABLE;
  if (raw.wid != null && (typeof raw.wid !== 'string' || !/^[0-9a-f]{16}$/.test(raw.wid))) return UNREADABLE;
  if (raw.draft !== null && !(isObj(raw.draft) && typeof raw.draft.programmeId === 'string')) return UNREADABLE;
  if (!Array.isArray(raw.published) || !raw.published.every(p => isObj(p) && Number.isInteger(p.rev) && p.rev >= 1 && isObj(p.snapshot) && Array.isArray(p.snapshot.routines))) return UNREADABLE;
  if (raw.applied !== null && !(isObj(raw.applied) && Number.isInteger(raw.applied.rev) && OUTCOMES.includes(raw.applied.outcome) && Array.isArray(raw.applied.routineIds))) return UNREADABLE;
  return { v: ASSIGNMENT_FORMAT, rev: raw.rev, wid: raw.wid || null, draft: raw.draft, published: raw.published, applied: raw.applied };
}

/** The latest published revision, or null. */
export const latest = doc => (doc?.published?.length ? doc.published[doc.published.length - 1] : null);

/** Every routine id the link has delivered: the applied ones and every retained snapshot's. */
export function assignedRoutineIds(doc) {
  const ids = new Set(doc?.applied?.routineIds || []);
  for (const p of doc?.published || []) for (const id of snapshotRoutineIds(p.snapshot)) ids.add(id);
  return ids;
}

export function createAssignmentStore({ dir, atomicWrite }) {
  const asDir = path.join(dir, 'assignments');
  const file = linkId => {
    if (typeof linkId !== 'string' || !LINK_ID_RE.test(linkId)) throw new Error('trainer: not a link id');
    return path.join(asDir, linkId + '.json');
  };

  /** The link's assignment; an empty one when there is none yet; UNREADABLE otherwise. */
  function read(linkId) {
    const raw = readJson(file(linkId));
    if (raw === null) return emptyAssignment();
    if (raw === UNREADABLE) return UNREADABLE;
    return cleanStoredAssignment(raw);
  }

  function write(linkId, doc) {
    fs.mkdirSync(asDir, { recursive: true });
    atomicWrite(file(linkId), JSON.stringify(doc));
  }

  /**
   * A trainer's write: `baseRev` (and `baseWid`, when given) must be the stored one, or nothing is
   * written and the current assignment comes back with a 409. Synchronous from read to rename.
   * `mutate(draft)` may throw (a refusal) and returns what the route answers.
   */
  function change(linkId, { baseRev, baseWid } = {}, mutate) {
    if (!Number.isInteger(baseRev) || baseRev < 0) return { status: 400, code: 'base-rev' };
    const cur = read(linkId);
    if (cur === UNREADABLE) return { status: 503, code: 'unreadable' };
    if (baseRev !== cur.rev || (typeof baseWid === 'string' && cur.wid && baseWid !== cur.wid)) return { status: 409, code: 'conflict', doc: cur };
    const draft = structuredClone(cur);
    const result = mutate(draft);
    if (result?.unchanged) return { status: 200, doc: cur, result };
    draft.published = draft.published.slice(-KEEP_PUBLISHED);
    draft.rev = cur.rev + 1;
    draft.wid = newWid();
    write(linkId, draft);
    return { status: 200, doc: draft, result };
  }

  /** The client's acknowledgement: changes `applied` only, without a base revision. */
  function acknowledge(linkId, mutate) {
    const cur = read(linkId);
    if (cur === UNREADABLE) return { status: 503, code: 'unreadable' };
    const draft = structuredClone(cur);
    const result = mutate(draft);
    if (result?.unchanged) return { status: 200, doc: cur, result };
    write(linkId, draft);
    return { status: 200, doc: draft, result };
  }

  function remove(linkId) {
    try { fs.unlinkSync(file(linkId)); return true; }
    catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  }

  /** The link ids that have a file. */
  function ids() {
    let names = [];
    try { names = fs.readdirSync(asDir); } catch { return []; }
    return names.filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).filter(id => LINK_ID_RE.test(id));
  }

  return { dir: asDir, file, read, change, acknowledge, remove, ids };
}

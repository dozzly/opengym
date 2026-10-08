/* The trainer module's own files under DATA_DIR/trainer/ (ADR 029, decision 4):
 *
 *   DATA_DIR/trainer/capabilities.json      who switched trainer tools on (capability.js)
 *   DATA_DIR/trainer/library/<uid>.json     one trainer's library (library.js)
 *   DATA_DIR/trainer/media/<uid>/…          that trainer's demo files (demo-media.js)
 *
 * Written only with the server's own atomicWrite (temporary file, fsync, rename), with the same
 * modes as upstream's state files: directories made like DATA_DIR itself, files as atomicWrite
 * leaves them. Upstream never reads or writes any of it, and this module never writes anything
 * outside it.
 *
 * Never deletes because something is missing: a library file that is not there reads as an empty
 * library, and one that cannot be read or parsed reads as UNREADABLE. Nothing replaces an
 * unreadable file (every write answers 503), and the demo-media sweep keeps every file of a
 * trainer whose library it cannot read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanStoredLibrary, emptyLibrary, newWid } from './library.js';

export const UNREADABLE = Symbol('trainer store unreadable');

/** The same sanitising as server.js stateFile(). An id that sanitises to nothing is refused, so
 *  no request can ever name the library directory itself. */
export function safeUid(uid) {
  const s = String(uid ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!s) throw new Error('trainer: a profile id is required');
  return s;
}

/** JSON at `file`: the value, null when there is no such file, UNREADABLE for anything else (a
 *  file holding the JSON `null` included: that is a damaged file, not a missing one). */
export function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? null : UNREADABLE; }
  try { return JSON.parse(raw) ?? UNREADABLE; } catch { return UNREADABLE; }
}

export function createLibraryStore({ dir, atomicWrite, log = console }) {
  const libDir = path.join(dir, 'library');
  const file = uid => path.join(libDir, safeUid(uid) + '.json');

  /** The trainer's library; an empty one when there is none yet; UNREADABLE when the file is not
   *  one this module could have written. */
  function read(uid) {
    const raw = readJson(file(uid));
    if (raw === null) return emptyLibrary();
    if (raw === UNREADABLE) return UNREADABLE;
    try { return cleanStoredLibrary(raw); }
    catch (e) { log.error?.('trainer: library file of', safeUid(uid), 'is not a library:', e.message); return UNREADABLE; }
  }
  /** Whether a library file exists at all (the sweep keeps everything of a trainer without one). */
  const exists = uid => fs.existsSync(file(uid));

  /**
   * One conditional write, PUT /api/data's semantics: `baseRev` must be the stored revision (and
   * `baseWid`, when given, the stored write id), or nothing is written and the current library
   * comes back with a 409. `mutate(draft)` changes a copy and returns what the route answers; it
   * may throw (a refusal), and returns { unchanged: true } when there is nothing to write. The
   * read, the check and the write are synchronous with nothing awaited between them, so the
   * compare-and-write is atomic for this process, as it is for state files.
   */
  function change(uid, { baseRev, baseWid } = {}, mutate) {
    if (!Number.isInteger(baseRev) || baseRev < 0) return { status: 400, code: 'base-rev' };
    const cur = read(uid);
    if (cur === UNREADABLE) return { status: 503, code: 'unreadable' };
    if (baseRev !== cur.rev || (typeof baseWid === 'string' && cur.wid && baseWid !== cur.wid)) {
      return { status: 409, code: 'conflict', doc: cur };
    }
    const draft = structuredClone(cur);
    const result = mutate(draft);
    if (result?.unchanged) return { status: 200, doc: cur, result };
    draft.rev = cur.rev + 1;
    draft.wid = newWid();
    fs.mkdirSync(libDir, { recursive: true });
    atomicWrite(file(uid), JSON.stringify(draft));
    return { status: result?.created ? 201 : 200, doc: draft, result };
  }

  return { dir: libDir, file, read, exists, change };
}

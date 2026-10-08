/* Trainer demo media: the photo or video that shows how a library exercise is done.
 *
 * A security domain of its own (ADR 029, decision 6; roadmap guardrails): demo files never live in
 * DATA_DIR/uploads/, where a profile's private custom-exercise and workout media are, and nothing
 * here can reach that folder. The module runs its own instance of upstream's media store
 * (api/media.js createMediaStore, unmodified) on its own directory:
 *
 *   DATA_DIR/trainer/media/<uid>/<sha256>.<ext>    0700 directories, 0600 files, as upstream's
 *
 * so the same promises hold: content-addressed by the hash the app computed, sniffed by magic
 * bytes, never decoded, never buffered, per-file caps and a per-trainer quota, and nothing deleted
 * because something is missing. The store's `readState(uid)` is this trainer's library as a
 * pseudo-state whose custom exercises carry the library's media refs, archived exercises
 * included; upstream's sweep and grace logic then keeps exactly what the library uses, and a
 * library file that is missing or unreadable keeps everything.
 *
 * Who may read a demo is one decision, canReadDemo(): the trainer who owns it, with trainer tools
 * switched on, and (FIT-004) the client of an active link with that trainer, for a hash a
 * published snapshot of that link names. Everyone else gets the 404 a file that does not exist
 * gets, and an ended link reads nothing from the moment it ends.
 *
 * What the sweep keeps is the library's demos and every demo a retained published snapshot names
 * (`published.refs(uid)`): replacing a demo in the library does not take the old file from a client
 * who has not applied, or not yet copied, the revision that names it. When an assignment file
 * cannot be read, nothing of that trainer's is removed.
 */
import path from 'node:path';
import { createMediaStore, mediaLimits, HASH_RE } from '../media.js';
import { UNREADABLE } from './store.js';

export const DEFAULT_QUOTA_MB = 500;

/** Upstream's media settings (MEDIA_* in the environment: caps per file, grace, hourly budget),
 *  with the per-trainer quota from TRAINER_MEDIA_QUOTA_MB (MiB, may be fractional; 0 = no cap). A
 *  value that does not parse falls back to the default, as upstream's own settings do. */
export function trainerMediaLimits(env = process.env) {
  const base = mediaLimits(env);
  const raw = env.TRAINER_MEDIA_QUOTA_MB;
  const n = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  return { ...base, quotaMB: Number.isFinite(n) && n >= 0 ? n : DEFAULT_QUOTA_MB };
}

/** The library as upstream's media store reads a state: a custom exercise per library exercise
 *  that has media, archived ones included (api/media.js referencedHashes walks customEx[].media),
 *  plus one per MediaRef in `published` (what retained published snapshots name). */
export const libraryRefsState = (doc, published = []) => ({
  customEx: [
    ...(doc?.exercises || []).filter(e => e.media).map(e => ({ id: e.id, media: e.media })),
    ...published.map(media => ({ id: 'published', media }))
  ]
});

/**
 * `published` (FIT-004, optional) answers two questions about links:
 *   refs(trainerUid)                      the MediaRefs the trainer's retained published
 *                                         snapshots name, or null when one cannot be read
 *   clientMayRead(viewer, trainer, hash)  whether `viewer` is the client of an active link with
 *                                         `trainer` whose published snapshots name `hash`
 */
export function createDemoMedia({ dir, library, capabilities, published = null, env = process.env, now = Date.now, log = console }) {
  const limits = trainerMediaLimits(env);
  // null = "do not infer anything": no library file yet, or a library or assignment that cannot
  // be read.
  const refsState = uid => {
    if (!library.exists(uid)) return null;
    const doc = library.read(uid);
    if (doc === UNREADABLE) return null;
    const extra = published ? published.refs(uid) : [];
    return extra === null ? null : libraryRefsState(doc, extra);
  };
  const store = createMediaStore({ dir: path.join(dir, 'media'), limits, now, readState: refsState, log });

  /** May `viewerUid` read the demo `hash` of `trainerUid`? The trainer, with trainer tools on; a
   *  linked client, for a hash the link's published snapshots name. Answered the same whether or
   *  not the file exists, so it reveals nothing. */
  function canReadDemo(viewerUid, trainerUid, hash) {
    if (!viewerUid || !trainerUid || typeof hash !== 'string' || !HASH_RE.test(hash)) return false;
    if (viewerUid === trainerUid) return capabilities.enabled(trainerUid);
    return !!published && published.clientMayRead(viewerUid, trainerUid, hash) === true;
  }

  /** Starts or stops the grace clock of each stored file of `uid` after a write that changed what
   *  is referenced (a library write, a publish, a link ending). Bookkeeping only. */
  function noteRefs(uid) {
    try {
      const S = refsState(uid);
      if (S) store.noteState(uid, S);
    } catch (e) { log.error?.('trainer media: noteState failed', e.message); }
  }
  const noteLibrary = uid => noteRefs(uid);

  return { store, limits, canReadDemo, noteLibrary, noteRefs };
}

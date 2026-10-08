/* The module's data of profiles that no longer exist (FIT-004). When an admin deletes a profile,
 * upstream removes its state and uploads; this removes what the module kept about it, beside the
 * hourly demo-media sweep:
 *   - invites of a trainer who is gone;
 *   - links naming a trainer or client who is gone, and their assignment files;
 *   - assignment files of a link that ended, or that links.json does not know;
 *   - a gone trainer's library and demo files, and their capability switch.
 * A client keeps everything it applied: it is in its own profile, demo copies included.
 *
 * Nothing happens when the list of profiles is empty (a db.json that read as nobody is not a
 * reason to delete anybody's data), and nothing that depends on links.json happens when it
 * cannot be read. Returns counts, for the log; never names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeUid, UNREADABLE } from './store.js';
import { isActive } from './links.js';

function knownIds(users) {
  const out = new Set();
  for (const u of users() || []) { try { out.add(safeUid(u?.id)); } catch { /* an unusable id */ } }
  return out;
}

export function sweepOrphans({ dir, users, links, assignments, library, demo = null, capabilities, log = console }) {
  const res = { skipped: false, invites: 0, links: 0, assignments: 0, libraries: 0, media: 0, capabilities: 0 };
  const known = knownIds(users);
  if (!known.size) { res.skipped = true; return res; }
  const gone = uid => { try { return !known.has(safeUid(uid)); } catch { return true; } };

  // Links and invites, and the assignments that hang off them.
  const out = links.change(doc => {
    const invites = doc.invites.filter(i => !gone(i.trainer));
    const kept = doc.links.filter(l => !gone(l.trainer) && !gone(l.client));
    res.invites = doc.invites.length - invites.length;
    res.links = doc.links.length - kept.length;
    if (!res.invites && !res.links) return { unchanged: true };
    doc.invites = invites;
    doc.links = kept;
    return {};
  });
  // Only against a links.json that is there: a missing one is not a reason to delete anything.
  if (out.status === 200 && links.exists()) {
    const live = new Set(out.doc.links.filter(isActive).map(l => l.id));
    for (const id of assignments.ids()) {
      if (live.has(id)) continue;
      try { if (assignments.remove(id)) res.assignments++; } catch (e) { log.error?.('trainer: could not remove an assignment', e.message); }
    }
  }

  // A gone trainer's library and demo files.
  let names = [];
  try { names = fs.readdirSync(library.dir); } catch { /* none yet */ }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const uid = n.slice(0, -5);
    if (!gone(uid)) continue;
    try { fs.unlinkSync(path.join(library.dir, n)); res.libraries++; } catch (e) { log.error?.('trainer: could not remove a library', e.message); }
  }
  const mediaDir = path.join(dir, 'media');
  let folders = [];
  try { folders = fs.readdirSync(mediaDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { /* none yet */ }
  for (const uid of folders) {
    if (!gone(uid)) continue;
    try {
      if (demo) demo.store.removeUser(uid);
      else fs.rmSync(path.join(mediaDir, safeUid(uid)), { recursive: true, force: true });
      res.media++;
    } catch (e) { log.error?.('trainer: could not remove demo files', e.message); }
  }

  const caps = capabilities.read();
  if (caps !== UNREADABLE) res.capabilities = capabilities.prune(uid => !gone(uid));
  return res;
}

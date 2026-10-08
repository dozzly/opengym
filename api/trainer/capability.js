/* Trainer capability: whether a signed-in user has switched trainer tools on for themselves.
 *
 *   DATA_DIR/trainer/capabilities.json   { v: 1, users: { <uid>: { enabled, at } } }
 *
 * Self-service, and never an admin appointment (ADR 029, decision 7). TRAINER_ALLOW, when set, is
 * the comma-separated list of user ids who may switch it on; unset (or empty), anyone signed in
 * may. Someone taken off that list counts as switched off, without their record being touched.
 *
 * What switching on grants: access to the trainer's own library and demo files, and nothing
 * else. No other user's data, no link to anyone — links need the client's consent (FIT-004).
 * Switching off keeps the library and its files as they are and refuses every write.
 *
 * A capabilities file that cannot be read reads as nobody switched on, and is never replaced: a
 * change answers 503 until the file is readable again (restored from a backup, or removed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, safeUid, UNREADABLE } from './store.js';

/** The ids TRAINER_ALLOW names, or null when it is unset or empty (anyone may). */
export function allowList(env = process.env) {
  const ids = String(env.TRAINER_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

export function createCapabilities({ dir, atomicWrite, env = process.env, now = Date.now }) {
  const file = path.join(dir, 'capabilities.json');
  const allow = allowList(env);

  function read() {
    const raw = readJson(file);
    if (raw === null) return { v: 1, users: {} };
    if (raw === UNREADABLE || !raw || typeof raw !== 'object' || !raw.users || typeof raw.users !== 'object' || Array.isArray(raw.users)) return UNREADABLE;
    return raw;
  }
  const mayEnable = uid => !allow || allow.has(String(uid));
  /** Switched on, and still allowed to be. */
  function enabled(uid) {
    if (!uid || !mayEnable(uid)) return false;
    const doc = read();
    if (doc === UNREADABLE) return false;
    return doc.users[safeUid(uid)]?.enabled === true;
  }
  /** { status: 200, enabled } | { status: 403, code: 'not-allowed' } | { status: 503, code: 'unreadable' } */
  function set(uid, on) {
    if (on && !mayEnable(uid)) return { status: 403, code: 'not-allowed' };
    const doc = read();
    if (doc === UNREADABLE) return { status: 503, code: 'unreadable' };
    const id = safeUid(uid);
    if ((doc.users[id]?.enabled === true) === on) return { status: 200, enabled: on, unchanged: true };
    doc.users[id] = { enabled: on, at: now() };
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(file, JSON.stringify({ v: 1, users: doc.users }));
    return { status: 200, enabled: on };
  }
  /** Drops the switch of every user `keep(uid)` says no to (a deleted profile). Returns how many
   *  went; writes only when one did, and never over a file that cannot be read. */
  function prune(keep) {
    const doc = read();
    if (doc === UNREADABLE) return 0;
    const ids = Object.keys(doc.users).filter(id => !keep(id));
    if (!ids.length) return 0;
    for (const id of ids) delete doc.users[id];
    atomicWrite(file, JSON.stringify({ v: 1, users: doc.users }));
    return ids.length;
  }
  return { file, read, mayEnable, enabled, set, prune, restricted: !!allow };
}

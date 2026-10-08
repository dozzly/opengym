/* Consent (ADR 029, decision 7; FIT-004): one-time invitations, and the links clients accept.
 *
 *   DATA_DIR/trainer/links.json   { v: 1, invites: [invite], links: [link] }
 *
 *   invite { id: iv_<16 hex>, trainer, hash, createdAt, expiresAt, usedAt?, usedBy?, link?, revokedAt? }
 *   link   { id: lk_<16 hex>, trainer, client, mode, scopes, shareBodyweight, createdAt,
 *            revokedAt?, revokedBy? }
 *
 * - A code is `PT-` and 12 base32 characters (60 bits) from crypto. It is shown to the trainer once
 *   and never stored: an invite keeps its SHA-256 and expires after seven days. A trainer has at
 *   most ten open invites.
 * - Accepting consumes the invite and creates the link in one synchronous read-check-write, so a
 *   code can be used once, whatever arrives at the same time.
 * - A link carries exactly two scopes, `read_progress` and `write_assigned_plan`, and the mode the
 *   client chose: `co-managed` (the client reviews each update) or `trainer-managed` (updates are
 *   applied as they arrive). One active trainer per client in the MVP.
 * - Either side ends a link at once (`revokedAt`). An ended link stays on record with ids and
 *   times only; it grants nothing.
 *
 * Nothing is ever deleted because something is missing, and a file that cannot be read is never
 * replaced: every write answers 503 until it is restored. Closed invites (used, revoked, expired)
 * are dropped a month after they closed, so the file does not grow for ever.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, UNREADABLE } from './store.js';

export const LINKS_FORMAT = 1;
export const LINK_ID_RE = /^lk_[0-9a-f]{16}$/;
export const INVITE_ID_RE = /^iv_[0-9a-f]{16}$/;
export const MODES = Object.freeze(['co-managed', 'trainer-managed']);
export const SCOPES = Object.freeze(['read_progress', 'write_assigned_plan']);

const DAY = 86400000;
export const INVITE_TTL_MS = 7 * DAY;
export const MAX_OPEN_INVITES = 10;
export const KEEP_CLOSED_MS = 30 * DAY;

/** A refusal: `code` for the app, `status` for the answer. `guess` marks a code that matched no
 *  usable invite, which the limiter counts. */
export class LinkError extends Error {
  constructor(status, code, extra = {}, { guess = false } = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.guess = guess;
  }
}

/* ---------------------------------------------------------------- codes */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_RE = /^PT-[A-Z2-7]{12}$/;

/** A new one-time code: `PT-` and 12 base32 characters, each drawn uniformly by crypto. */
export const newInviteCode = () => 'PT-' + Array.from({ length: 12 }, () => B32[crypto.randomInt(32)]).join('');

/** A code as typed (any case, spaces or dashes between groups) in its one form, or null. */
export function normalizeCode(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  const code = s.startsWith('PT') ? 'PT-' + s.slice(2) : null;
  return code && CODE_RE.test(code) ? code : null;
}

/** What is stored of a code. */
export const codeHash = code => crypto.createHash('sha256').update(code).digest('hex');

export const newLinkId = () => 'lk_' + crypto.randomBytes(8).toString('hex');
export const newInviteId = () => 'iv_' + crypto.randomBytes(8).toString('hex');

/* ---------------------------------------------------------------- the document */

export const emptyLinks = () => ({ v: LINKS_FORMAT, invites: [], links: [] });

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isStamp = v => Number.isFinite(v) && v >= 0;
const isUid = v => typeof v === 'string' && v.length > 0 && v.length <= 200;

function validInvite(i) {
  return isObj(i) && INVITE_ID_RE.test(i.id) && isUid(i.trainer) && typeof i.hash === 'string' && /^[0-9a-f]{64}$/.test(i.hash) &&
    isStamp(i.createdAt) && isStamp(i.expiresAt);
}
function validLink(l) {
  return isObj(l) && LINK_ID_RE.test(l.id) && isUid(l.trainer) && isUid(l.client) && MODES.includes(l.mode) &&
    Array.isArray(l.scopes) && typeof l.shareBodyweight === 'boolean' && isStamp(l.createdAt);
}

/** links.json's parsed JSON as the document, or UNREADABLE when it is not one this module wrote. */
export function cleanStoredLinks(raw) {
  if (!isObj(raw) || raw.v !== LINKS_FORMAT || !Array.isArray(raw.invites) || !Array.isArray(raw.links)) return UNREADABLE;
  if (!raw.invites.every(validInvite) || !raw.links.every(validLink)) return UNREADABLE;
  return raw;
}

const closedAt = i => i.usedAt || i.revokedAt || i.expiresAt;
/** Open: not used, not revoked, not expired at `t`. */
export const isOpen = (i, t) => !i.usedAt && !i.revokedAt && i.expiresAt > t;
export const openInvites = (doc, trainer, t) => doc.invites.filter(i => i.trainer === trainer && isOpen(i, t));
export const isActive = l => !!l && !l.revokedAt;
/** The client's active link, if any (one trainer per client). */
export const activeLinkOf = (doc, client) => doc.links.find(l => l.client === client && isActive(l)) || null;
/** The active link `id`, if any. */
export const activeLink = (doc, id) => (typeof id === 'string' && LINK_ID_RE.test(id) ? doc.links.find(l => l.id === id && isActive(l)) || null : null);
export const linksAsTrainer = (doc, trainer) => doc.links.filter(l => l.trainer === trainer && isActive(l));

/** An invite as its trainer sees it: never the code, never its hash. */
export const publicInvite = i => ({ id: i.id, createdAt: i.createdAt, expiresAt: i.expiresAt });

/**
 * The invite a code names, checked for use by `client` at `t`. Throws LinkError: 400 invalid, 404
 * unknown, 410 expired, used or revoked (all four count as a guess), 400 self-link.
 */
export function inviteForCode(doc, rawCode, client, t) {
  const code = normalizeCode(rawCode);
  if (!code) throw new LinkError(400, 'invite-invalid', {}, { guess: true });
  const hash = codeHash(code);
  const inv = doc.invites.find(i => i.hash === hash);
  if (!inv) throw new LinkError(404, 'invite-unknown', {}, { guess: true });
  if (inv.usedAt) throw new LinkError(410, 'invite-used', {}, { guess: true });
  if (inv.revokedAt) throw new LinkError(410, 'invite-revoked', {}, { guess: true });
  if (!(inv.expiresAt > t)) throw new LinkError(410, 'invite-expired', {}, { guess: true });
  if (inv.trainer === client) throw new LinkError(400, 'self-link');
  return inv;
}

/* ---------------------------------------------------------------- the store */

export function createLinkStore({ dir, atomicWrite, now = Date.now }) {
  const file = path.join(dir, 'links.json');

  /** The document; an empty one when there is no file; UNREADABLE otherwise. */
  function read() {
    const raw = readJson(file);
    if (raw === null) return emptyLinks();
    if (raw === UNREADABLE) return UNREADABLE;
    return cleanStoredLinks(raw);
  }

  /**
   * One read-change-write, synchronous from the read to the rename, so it is atomic for this
   * process (an invite is consumed once). `mutate(draft, t)` changes a copy and returns what the
   * route answers, { unchanged: true } when there is nothing to write; it may throw (a refusal).
   * Answers { status: 503 } for an unreadable file, else { status: 200, doc, result }.
   */
  function change(mutate) {
    const cur = read();
    if (cur === UNREADABLE) return { status: 503, code: 'unreadable' };
    const t = now();
    const draft = structuredClone(cur);
    const result = mutate(draft, t);
    if (result?.unchanged) return { status: 200, doc: cur, result };
    draft.invites = draft.invites.filter(i => isOpen(i, t) || t - closedAt(i) < KEEP_CLOSED_MS);
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(file, JSON.stringify(draft));
    return { status: 200, doc: draft, result };
  }

  return { file, read, change, exists: () => fs.existsSync(file) };
}

/* ---------------------------------------------------------------- the code limiter */

/**
 * Wrong codes per user: at most `max` in any `windowMs` (10 an hour). In memory, like upstream's
 * own sign-in throttles: a restart forgets it, which costs a guesser nothing worth having against
 * a 60-bit code that lives a week. `wait(uid)` is the seconds until the next try is allowed (0:
 * now); `fail(uid)` records one wrong code.
 */
export function createCodeLimiter({ max = 10, windowMs = 3600000, now = Date.now } = {}) {
  const fails = new Map();   // uid -> timestamps, oldest first
  const live = (uid, t) => {
    const list = (fails.get(uid) || []).filter(x => t - x < windowMs);
    if (list.length) fails.set(uid, list); else fails.delete(uid);
    return list;
  };
  return {
    wait(uid) {
      const t = now();
      const list = live(uid, t);
      return list.length >= max ? Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000)) : 0;
    },
    fail(uid) {
      const t = now();
      const list = live(uid, t);
      list.push(t);
      fails.set(uid, list);
      // Bounded by the number of users who typed a wrong code within the hour.
      if (fails.size > 1000) for (const k of [...fails.keys()]) live(k, t);
    },
    size: () => fails.size
  };
}

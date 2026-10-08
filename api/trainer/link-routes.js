/* The FIT-004 routes: consent (invites, links), assignments (draft, publish, the client's
 * acknowledgement) and progress. Built by routes.js with the server's helpers and the module's
 * stores; every route is absent with the module off, like the rest of it.
 *
 *   POST   /api/trainer/invites                 trainer: a one-time code, shown once
 *   GET    /api/trainer/invites                 trainer: open invites, without codes
 *   DELETE /api/trainer/invites                 trainer: ?id= revokes one
 *   POST   /api/trainer/links/accept            anyone signed in: { code, mode, shareBodyweight }
 *   GET    /api/trainer/links                   the caller's links, as trainer and as client
 *   POST   /api/trainer/links/update            client: { id, mode?, shareBodyweight? }
 *   POST   /api/trainer/links/revoke            either side: { id }, at once
 *   GET    /api/trainer/assignments?link=       trainer: draft, published, applied, preview
 *   PUT    /api/trainer/assignments/draft       trainer: { link, programmeId, note, baseRev }
 *   POST   /api/trainer/assignments/publish     trainer: { link, baseRev, libraryRev? }
 *   GET    /api/trainer/assignment              client: the current published revision
 *   POST   /api/trainer/assignment/ack          client: { link, rev, outcome, routineIds }
 *   GET    /api/trainer/progress?link=          trainer: the link's workouts (progress.js)
 *
 * Who may do what:
 *   - Trainer routes need trainer tools on (403 trainer-off), and name a link by id: one that is
 *     not an active link of the caller's, in the role the route needs, is a 404, the same answer
 *     whether it exists or not, and audited as `.denied`. Nothing takes a user id.
 *   - Accepting needs only a session. Wrong codes are counted per user, ten an hour (429).
 *   - Ending a link needs only a session, so a trainer who switched tools off can still end one.
 *
 * Audit: ids, revisions, counts and modes, never a code, a name, a note or any content.
 */
import {
  LinkError, MODES, SCOPES, INVITE_TTL_MS, MAX_OPEN_INVITES, INVITE_ID_RE, LINK_ID_RE,
  newInviteCode, codeHash, newInviteId, newLinkId, inviteForCode, openInvites, publicInvite,
  activeLink, activeLinkOf, linksAsTrainer
} from './links.js';
import { OUTCOMES, latest, assignedRoutineIds } from './assignments.js';
import { snapshotProgramme, snapshotHashes, snapshotRoutineIds } from './snapshot.js';
import { progressView, routineNames } from './progress.js';
import { LibraryError, PROG_ID_RE, ROUTINE_ID_RE, cleanNote } from './library.js';
import { UNREADABLE } from './store.js';

const query = req => new URL(req.url || '/', 'http://x').searchParams;
const idOrDash = (id, re) => (typeof id === 'string' && re.test(id) ? id : '-');

export function linkRoutes(ctx) {
  const {
    json, readSession, readBody, note, now, trainerOf, log,
    caps, library, links, assignments, limiter, demo, users, readStateStrict, stateUnreadable, sendPush
  } = ctx;

  const nameOf = uid => {
    const u = (users() || []).find(x => x?.id === uid);
    return u ? String(u.name || '') : null;
  };
  const trainerView = l => ({ id: l.id, client: { id: l.client, name: nameOf(l.client) }, mode: l.mode, shareBodyweight: l.shareBodyweight, scopes: [...l.scopes], createdAt: l.createdAt });
  const clientView = l => ({ id: l.id, trainer: { id: l.trainer, name: nameOf(l.trainer) }, mode: l.mode, shareBodyweight: l.shareBodyweight, scopes: [...l.scopes], createdAt: l.createdAt });
  const unreadable = (res, what = 'the trainer links') => json(res, 503, { error: `${what} cannot be read`, code: 'unreadable' });
  const notFound = res => json(res, 404, { error: 'no such link', code: 'not-found' });

  /** The active link `id` in which the caller has `role` ('trainer', 'client' or 'either'), or
   *  null after answering 404 (audited as `ev`) or 503. */
  function linkFor(req, res, user, id, role, ev) {
    const doc = links.read();
    if (doc === UNREADABLE) { unreadable(res); return null; }
    const l = activeLink(doc, id);
    const ok = l && (role === 'trainer' ? l.trainer === user.id : role === 'client' ? l.client === user.id : l.trainer === user.id || l.client === user.id);
    if (!ok) {
      note(req, ev, user.id, `${role} ${idOrDash(id, LINK_ID_RE)}: no such link`, false);
      notFound(res);
      return null;
    }
    return l;
  }

  function refusedLink(req, res, uid, ev, e) {
    if (!(e instanceof LinkError)) throw e;
    note(req, ev, uid, e.code, false);
    json(res, e.status, { error: e.message, code: e.code, ...e.extra });
  }

  // The trainer's demo files a publish or an ended link stopped or started referencing.
  const noteRefs = uid => { if (demo) demo.noteRefs(uid); };
  // Never awaited: a push that cannot be delivered is the push service's business, not the route's.
  function push(uid, payload) {
    try { Promise.resolve(sendPush(uid, payload)).catch(e => log.error?.('trainer: push failed', e?.message)); }
    catch (e) { log.error?.('trainer: push failed', e?.message); }
  }

  const routes = {
    /* ---------- invites ---------- */
    'POST /api/trainer/invites': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.invite.denied');
      if (!user) return;
      await readBody(req);
      let out;
      try {
        out = links.change((doc, t) => {
          const open = openInvites(doc, user.id, t).length;
          if (open >= MAX_OPEN_INVITES) throw new LinkError(409, 'too-many-invites', { max: MAX_OPEN_INVITES });
          const code = newInviteCode();
          const invite = { id: newInviteId(), trainer: user.id, hash: codeHash(code), createdAt: t, expiresAt: t + INVITE_TTL_MS };
          doc.invites.push(invite);
          return { code, invite, open: open + 1 };
        });
      } catch (e) { return refusedLink(req, res, user.id, 'trainer.invite.denied', e); }
      if (out.status === 503) return unreadable(res);
      const { code, invite, open } = out.result;
      note(req, 'trainer.invite.create', user.id, `${invite.id}, ${open} open`);
      json(res, 201, { code, invite: publicInvite(invite) });
    },
    'GET /api/trainer/invites': async (req, res) => {
      const user = trainerOf(req, res);
      if (!user) return;
      const doc = links.read();
      if (doc === UNREADABLE) return unreadable(res);
      json(res, 200, { invites: openInvites(doc, user.id, now()).map(publicInvite), max: MAX_OPEN_INVITES });
    },
    'DELETE /api/trainer/invites': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.invite.denied');
      if (!user) return;
      const body = await readBody(req);
      const id = typeof body.id === 'string' ? body.id : query(req).get('id');
      let out;
      try {
        out = links.change((doc, t) => {
          const inv = doc.invites.find(i => i.id === id && i.trainer === user.id);
          if (!inv || inv.usedAt || inv.revokedAt || !(inv.expiresAt > t)) throw new LinkError(404, 'not-found');
          inv.revokedAt = t;
          return { invite: inv };
        });
      } catch (e) {
        if (e instanceof LinkError) { note(req, 'trainer.invite.denied', user.id, `revoke ${idOrDash(id, INVITE_ID_RE)}: ${e.code}`, false); return json(res, e.status, { error: 'no such open invite', code: e.code }); }
        throw e;
      }
      if (out.status === 503) return unreadable(res);
      note(req, 'trainer.invite.revoke', user.id, out.result.invite.id);
      json(res, 200, { ok: true });
    },

    /* ---------- links ---------- */
    'POST /api/trainer/links/accept': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      // Before the code is even looked at, so a guesser past the limit learns nothing.
      const wait = limiter.wait(user.id);
      if (wait) {
        note(req, 'trainer.link.denied', user.id, 'accept: too many wrong codes', false);
        return json(res, 429, { error: 'too many wrong codes, try again later', code: 'locked', retryAfter: wait }, { 'Retry-After': String(wait) });
      }
      if (!MODES.includes(body.mode)) return json(res, 400, { error: 'mode must be co-managed or trainer-managed', code: 'invalid', field: 'mode' });
      if (body.shareBodyweight != null && typeof body.shareBodyweight !== 'boolean') return json(res, 400, { error: 'shareBodyweight must be true or false', code: 'invalid', field: 'shareBodyweight' });
      let out;
      try {
        out = links.change((doc, t) => {
          const inv = inviteForCode(doc, body.code, user.id, t);
          // A trainer who is gone, or who switched trainer tools off since inviting, cannot be linked.
          if (nameOf(inv.trainer) === null || !caps.enabled(inv.trainer)) throw new LinkError(410, 'trainer-unavailable');
          if (activeLinkOf(doc, user.id)) throw new LinkError(409, 'has-trainer');
          const link = {
            id: newLinkId(), trainer: inv.trainer, client: user.id, mode: body.mode, scopes: [...SCOPES],
            shareBodyweight: body.shareBodyweight === true, createdAt: t
          };
          inv.usedAt = t;
          inv.usedBy = user.id;
          inv.link = link.id;
          doc.links.push(link);
          return { link, invite: inv.id };
        });
      } catch (e) {
        if (e instanceof LinkError && e.guess) limiter.fail(user.id);
        return refusedLink(req, res, user.id, 'trainer.link.denied', e);
      }
      if (out.status === 503) return unreadable(res);
      const { link, invite } = out.result;
      note(req, 'trainer.link.accept', user.id, `${link.id} via ${invite}, trainer ${link.trainer}, ${link.mode}, body weight ${link.shareBodyweight ? 'shared' : 'not shared'}`);
      json(res, 201, { link: clientView(link) });
    },
    'GET /api/trainer/links': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const doc = links.read();
      if (doc === UNREADABLE) return unreadable(res);
      const asTrainer = linksAsTrainer(doc, user.id).map(l => {
        const a = assignments.read(l.id);
        const p = a === UNREADABLE ? null : latest(a);
        return {
          ...trainerView(l),
          published: p ? { rev: p.rev, at: p.at } : null,
          applied: a === UNREADABLE || !a.applied ? null : { rev: a.applied.rev, at: a.applied.at, outcome: a.applied.outcome }
        };
      });
      const mine = activeLinkOf(doc, user.id);
      json(res, 200, { asTrainer, asClient: mine ? clientView(mine) : null });
    },
    'POST /api/trainer/links/update': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      if (body.mode !== undefined && !MODES.includes(body.mode)) return json(res, 400, { error: 'mode must be co-managed or trainer-managed', code: 'invalid', field: 'mode' });
      if (body.shareBodyweight !== undefined && typeof body.shareBodyweight !== 'boolean') return json(res, 400, { error: 'shareBodyweight must be true or false', code: 'invalid', field: 'shareBodyweight' });
      if (body.mode === undefined && body.shareBodyweight === undefined) return json(res, 400, { error: 'nothing to change', code: 'invalid' });
      if (!linkFor(req, res, user, body.id, 'client', 'trainer.link.denied')) return;
      let out;
      try {
        out = links.change(doc => {
          const l = activeLink(doc, body.id);
          if (!l || l.client !== user.id) throw new LinkError(404, 'not-found');
          const next = { mode: body.mode ?? l.mode, shareBodyweight: body.shareBodyweight ?? l.shareBodyweight };
          if (next.mode === l.mode && next.shareBodyweight === l.shareBodyweight) return { unchanged: true, link: l };
          Object.assign(l, next);
          return { link: l };
        });
      } catch (e) { return refusedLink(req, res, user.id, 'trainer.link.denied', e); }
      if (out.status === 503) return unreadable(res);
      const l = out.result.link;
      if (!out.result.unchanged) note(req, 'trainer.link.update', user.id, `${l.id}, ${l.mode}, body weight ${l.shareBodyweight ? 'shared' : 'not shared'}`);
      json(res, 200, { link: clientView(l) });
    },
    'POST /api/trainer/links/revoke': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      if (!linkFor(req, res, user, body.id, 'either', 'trainer.link.denied')) return;
      let out;
      try {
        out = links.change((doc, t) => {
          const l = activeLink(doc, body.id);
          if (!l || (l.trainer !== user.id && l.client !== user.id)) throw new LinkError(404, 'not-found');
          l.revokedAt = t;
          l.revokedBy = user.id;
          return { link: l };
        });
      } catch (e) { return refusedLink(req, res, user.id, 'trainer.link.denied', e); }
      if (out.status === 503) return unreadable(res);
      const l = out.result.link;
      // From here the link grants nothing: progress, publishing and demo reads all check that it is
      // active. Its assignment goes too; the client keeps what it applied, in its own profile.
      try { assignments.remove(l.id); } catch (e) { log.error?.('trainer: could not remove an assignment', e.message); }
      noteRefs(l.trainer);
      note(req, 'trainer.link.revoke', user.id, `${l.id}, by the ${l.trainer === user.id ? 'trainer' : 'client'}`);
      json(res, 200, { ok: true });
    },

    /* ---------- assignments: the trainer's side ---------- */
    'GET /api/trainer/assignments': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.assignment.denied');
      if (!user) return;
      const l = linkFor(req, res, user, query(req).get('link'), 'trainer', 'trainer.assignment.denied');
      if (!l) return;
      const a = assignments.read(l.id);
      if (a === UNREADABLE) return unreadable(res, 'the assignment');
      const lib = library.read(user.id);
      let preview = null, programme = null;
      if (a.draft && lib !== UNREADABLE) {
        const p = lib.programmes.find(x => x.id === a.draft.programmeId);
        if (p) {
          programme = { id: p.id, rev: p.rev, name: p.name, archived: p.archived };
          preview = snapshotProgramme(lib, p.id, { trainer: user.id, assignmentId: l.id, rev: (latest(a)?.rev || 0) + 1 });
        }
      }
      json(res, 200, { link: trainerView(l), ...a, programme, preview, libraryRev: lib === UNREADABLE ? null : lib.rev });
    },
    'PUT /api/trainer/assignments/draft': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.assignment.denied');
      if (!user) return;
      const body = await readBody(req);
      const l = linkFor(req, res, user, body.link, 'trainer', 'trainer.assignment.denied');
      if (!l) return;
      let draft = null;
      try {
        if (body.programmeId !== null) {
          if (typeof body.programmeId !== 'string' || !PROG_ID_RE.test(body.programmeId)) throw new LibraryError('invalid', 'programmeId');
          const lib = library.read(user.id);
          if (lib === UNREADABLE) return unreadable(res, 'the trainer library');
          const p = lib.programmes.find(x => x.id === body.programmeId);
          if (!p) throw new LibraryError('unknown-programme', 'programmeId');
          if (p.archived) throw new LibraryError('archived-programme', 'programmeId');
          draft = { programmeId: p.id, note: cleanNote(body.note) };
        }
      } catch (e) {
        if (!(e instanceof LibraryError)) throw e;
        note(req, 'trainer.assignment.denied', user.id, `draft ${l.id}: ${e.code}`, false);
        return json(res, 400, { error: e.message, code: e.code, field: e.field });
      }
      const out = assignments.change(l.id, { baseRev: body.baseRev, baseWid: typeof body.baseWid === 'string' ? body.baseWid : undefined }, d => {
        if (JSON.stringify(d.draft) === JSON.stringify(draft)) return { unchanged: true };
        d.draft = draft;
        return {};
      });
      if (!answered(res, out)) return;
      if (!out.result.unchanged) note(req, 'trainer.assignment.draft', user.id, `${l.id} rev ${out.doc.rev}, ${draft ? draft.programmeId : 'cleared'}`);
      json(res, 200, { ok: true, rev: out.doc.rev, wid: out.doc.wid, draft: out.doc.draft });
    },
    'POST /api/trainer/assignments/publish': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.assignment.denied');
      if (!user) return;
      const body = await readBody(req);
      const l = linkFor(req, res, user, body.link, 'trainer', 'trainer.assignment.denied');
      if (!l) return;
      const lib = library.read(user.id);
      if (lib === UNREADABLE) return unreadable(res, 'the trainer library');
      // The library the trainer reviewed the diff against: published as reviewed, or not at all.
      if (body.libraryRev != null && body.libraryRev !== lib.rev) {
        return json(res, 409, { error: 'the library changed since the preview', code: 'library-changed', libraryRev: lib.rev });
      }
      let out;
      try {
        out = assignments.change(l.id, { baseRev: body.baseRev, baseWid: typeof body.baseWid === 'string' ? body.baseWid : undefined }, d => {
          if (!d.draft) throw new LinkError(400, 'no-draft');
          const p = lib.programmes.find(x => x.id === d.draft.programmeId);
          if (!p) throw new LinkError(400, 'unknown-programme');
          if (p.archived) throw new LinkError(400, 'archived-programme');
          const rev = (latest(d)?.rev || 0) + 1;
          // Built here, from the trainer's own library: the server never takes a client's snapshot.
          const snapshot = snapshotProgramme(lib, p.id, { trainer: user.id, assignmentId: l.id, rev });
          if (snapshot.unresolved.length) throw new LinkError(400, 'unresolved', { unresolved: snapshot.unresolved });
          const entry = { rev, at: now(), programmeId: p.id, programmeRev: p.rev, snapshot, note: d.draft.note || '' };
          d.published.push(entry);
          return { entry };
        });
      } catch (e) {
        if (!(e instanceof LinkError)) throw e;
        note(req, 'trainer.assignment.denied', user.id, `publish ${l.id}: ${e.code}${e.extra.unresolved ? ` (${e.extra.unresolved.length} slot(s))` : ''}`, false);
        return json(res, e.status, { error: e.message, code: e.code, ...e.extra });
      }
      if (!answered(res, out)) return;
      const { entry } = out.result;
      const s = entry.snapshot;
      noteRefs(user.id);
      push(l.client, {
        title: 'Plan update from your trainer',
        body: l.mode === 'trainer-managed' ? 'Open openGym to load it.' : 'Open openGym to review it.',
        tag: 'trainer-plan', url: '#/trainer'
      });
      note(req, 'trainer.assignment.publish', user.id,
        `${l.id} rev ${entry.rev}: ${entry.programmeId} rev ${entry.programmeRev}, ${s.routines.length} routine(s), ${s.customEx.length} exercise(s), ${snapshotHashes(s).size} media file(s)`);
      json(res, 200, { ok: true, rev: out.doc.rev, wid: out.doc.wid, published: entry });
    },

    /* ---------- assignments: the client's side ---------- */
    'GET /api/trainer/assignment': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const doc = links.read();
      if (doc === UNREADABLE) return unreadable(res);
      const l = activeLinkOf(doc, user.id);
      if (!l) return json(res, 200, { linked: false });
      const a = assignments.read(l.id);
      if (a === UNREADABLE) return unreadable(res, 'the assignment');
      json(res, 200, { linked: true, link: clientView(l), published: latest(a), applied: a.applied });
    },
    'POST /api/trainer/assignment/ack': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      const l = linkFor(req, res, user, body.link, 'client', 'trainer.assignment.denied');
      if (!l) return;
      const { rev, outcome, routineIds } = body;
      if (!Number.isInteger(rev) || rev < 1) return json(res, 400, { error: 'rev must be a published revision', code: 'invalid', field: 'rev' });
      if (!OUTCOMES.includes(outcome)) return json(res, 400, { error: 'outcome must be applied or discarded', code: 'invalid', field: 'outcome' });
      if (!Array.isArray(routineIds) || routineIds.length > 200 || !routineIds.every(id => typeof id === 'string' && ROUTINE_ID_RE.test(id))) {
        return json(res, 400, { error: 'routineIds must be routine ids', code: 'invalid', field: 'routineIds' });
      }
      let out;
      try {
        out = assignments.acknowledge(l.id, d => {
          const pub = d.published.find(p => p.rev === rev);
          if (!pub) throw new LinkError((latest(d)?.rev || 0) < rev ? 400 : 409, (latest(d)?.rev || 0) < rev ? 'unknown-rev' : 'stale', { applied: d.applied });
          if (d.applied && rev < d.applied.rev) throw new LinkError(409, 'stale', { applied: d.applied });
          // Applied: the routines of that revision. Discarded (or undone): the routines kept, which
          // can only be ones the link delivered. Either way the trainer's view never widens.
          const allowed = outcome === 'applied' ? new Set(snapshotRoutineIds(pub.snapshot)) : assignedRoutineIds(d);
          const ids = [...new Set(routineIds)];
          if (!ids.every(id => allowed.has(id))) throw new LinkError(400, 'routine-ids');
          const same = d.applied && d.applied.rev === rev && d.applied.outcome === outcome && JSON.stringify(d.applied.routineIds) === JSON.stringify(ids);
          if (same) return { unchanged: true };
          d.applied = { rev, at: now(), outcome, routineIds: ids };
          return {};
        });
      } catch (e) { return refusedLink(req, res, user.id, 'trainer.assignment.denied', e); }
      if (out.status === 503) return unreadable(res, 'the assignment');
      if (!out.result.unchanged) note(req, 'trainer.assignment.ack', user.id, `${l.id} rev ${rev} ${outcome}, ${out.doc.applied.routineIds.length} routine(s)`);
      json(res, 200, { ok: true, applied: out.doc.applied });
    },

    /* ---------- progress ---------- */
    'GET /api/trainer/progress': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.progress.denied');
      if (!user) return;
      const l = linkFor(req, res, user, query(req).get('link'), 'trainer', 'trainer.progress.denied');
      if (!l) return;
      if (!l.scopes.includes('read_progress')) {
        note(req, 'trainer.progress.denied', user.id, `${l.id}: no read_progress`, false);
        return notFound(res);
      }
      const a = assignments.read(l.id);
      if (a === UNREADABLE) return unreadable(res, 'the assignment');
      // Read-only: the client's state file is read here and never written by this module.
      const state = readStateStrict(l.client);
      if (state === stateUnreadable) return json(res, 503, { error: 'the client\'s data cannot be read', code: 'unreadable' });
      const view = progressView(state, { assignment: a, since: l.createdAt, shareBodyweight: l.shareBodyweight });
      const names = routineNames(a);
      const routines = [...assignedRoutineIds(a)].map(id => ({ id, name: names.get(id) || null }));
      note(req, 'trainer.progress.read', user.id, `${l.id}: ${view.workouts.length} workout(s)${l.shareBodyweight ? `, ${view.bodyweight.length} weigh-in(s)` : ''}`);
      json(res, 200, { link: trainerView(l), routines, ...view });
    }
  };

  // What an assignment write came back with, as an answer. True when it went through.
  function answered(res, out) {
    if (out.status === 400) { json(res, 400, { error: 'baseRev is required', code: out.code }); return false; }
    if (out.status === 503) { unreadable(res, 'the assignment'); return false; }
    if (out.status === 409) { json(res, 409, { error: 'conflict', code: 'conflict', rev: out.doc.rev, wid: out.doc.wid, assignment: out.doc }); return false; }
    return true;
  }

  return routes;
}

export const LINK_ROUTES = [
  'POST /api/trainer/invites', 'GET /api/trainer/invites', 'DELETE /api/trainer/invites',
  'POST /api/trainer/links/accept', 'GET /api/trainer/links', 'POST /api/trainer/links/update', 'POST /api/trainer/links/revoke',
  'GET /api/trainer/assignments', 'PUT /api/trainer/assignments/draft', 'POST /api/trainer/assignments/publish',
  'GET /api/trainer/assignment', 'POST /api/trainer/assignment/ack',
  'GET /api/trainer/progress'
];

/* HTTP surface of the trainer module (dozzly/opengym, ADR 029).
 *
 * Written as a factory taking server.js's own helpers, the way coach/routes.js is: they are
 * closures over the db and the session secret, and passing them in keeps this module free of an
 * import cycle and testable against fakes. server.js hands over one object with everything the
 * module is expected to need (api/server.js, the `...trainerRoutes({ … })` line), so that line
 * does not have to change each time the module starts using one more of them.
 *
 * Off unless TRAINER is set (1, true, yes or on). Off, the factory returns no routes at all and
 * every path below is the server's plain 404: what an upstream build answers, and what the app
 * reads as "this server has no trainer module". Nothing is created on disk at boot either way.
 *
 * Routes (FIT-003: one trainer's own library):
 *
 *   GET    /api/trainer/status                 module version (signed in)
 *   GET    /api/trainer/capability             { enabled, allowed }
 *   POST   /api/trainer/capability             { enabled } — self-service switch
 *   GET    /api/trainer/library                the caller's library, plus demo-media usage
 *   POST   /api/trainer/library/exercises      { baseRev, exercise }            create
 *   PUT    /api/trainer/library/exercises      { baseRev, id, exercise, archived? }  edit
 *   DELETE /api/trainer/library/exercises      ?id=&baseRev= (or the same in the body)  archive
 *   POST   /api/trainer/library/programmes     { baseRev, programme }           create
 *   PUT    /api/trainer/library/programmes     { baseRev, id, programme, archived? }  edit
 *   DELETE /api/trainer/library/programmes     ?id=&baseRev=                    archive
 *   GET    /api/trainer/library/export         portable JSON: media refs, no bytes
 *   PUT    /api/media/trainer?hash=<sha256>    upload a demo file (raw bytes)
 *   GET    /api/media/trainer?hash=<sha256>    a demo file (its trainer; a linked client, FIT-004)
 *
 * FIT-004 adds consent, assignments and progress (link-routes.js): invites, links, a draft and
 * published revisions per link, the client's acknowledgement, and read-only progress. The only
 * routes that read another user's data are the progress view of a linked client, and a demo file
 * for that client; both need an active link.
 *
 * The server's dispatcher keys on the exact path, so ids travel in the body or the query string.
 * The two media routes sit under /api/media/ because that is the one prefix the web container's
 * nginx lets large bodies through, unbuffered (web/nginx.conf.template). Every library and upload
 * route needs a session and trainer tools switched on; GET of a demo is canReadDemo()'s decision.
 *
 * What it will never do (ADR 029, decision 4): write a `state-<uid>.json`, `db.json` or anything
 * under DATA_DIR/uploads/. Its own data goes under DATA_DIR/trainer/ (storeDir), written with the
 * server's atomicWrite. Audit entries carry ids and counts, never names, instructions or bytes.
 */
import path from 'node:path';
import { HASH_RE, MediaError } from '../media.js';
import {
  LIMITS, EX_ID_RE, PROG_ID_RE, LibraryError, newId,
  cleanExerciseInput, exerciseRecord, sameExerciseContent,
  cleanProgrammeInput, programmeRecord, sameProgrammeContent, programmeExerciseIds,
  exportLibrary, mediaHashes
} from './library.js';
import { createLibraryStore, UNREADABLE } from './store.js';
import { createCapabilities } from './capability.js';
import { createDemoMedia, trainerMediaLimits } from './demo-media.js';
import { createLinkStore, createCodeLimiter, isActive } from './links.js';
import { createAssignmentStore } from './assignments.js';
import { snapshotHashes } from './snapshot.js';
import { sweepOrphans } from './cleanup.js';
import { linkRoutes } from './link-routes.js';

export const MODULE_VERSION = '0.3.2';

const ON = /^(1|true|yes|on)$/i;
export const trainerEnabled = (env = process.env) => ON.test(env.TRAINER || '');

/** The module's own store. Upstream never reads or writes it; deleting it removes the module's data. */
export const storeDir = dataDir => path.join(dataDir, 'trainer');

// The helpers the routes below call. Checked once at boot so a helper that upstream renamed or
// dropped stops the server with a clear message instead of failing on the first request.
const NEEDED = ['json', 'readSession', 'readBody', 'audit', 'atomicWrite', 'sendMediaFile', 'users', 'readStateStrict', 'sendPush'];

const HOUR = 3600000;
const query = req => new URL(req.url || '/', 'http://x').searchParams;
const intParam = v => (v == null ? undefined : /^\d{1,15}$/.test(v) ? Number(v) : NaN);

/**
 * `opts` is for the tests: the clock, whether to start the hourly sweep, a log, and `internals`,
 * an object the factory fills with its stores and the sweep the timer runs.
 */
export function trainerRoutes(helpers, env = process.env, { now = Date.now, timers = true, log = console, internals = null } = {}) {
  if (!trainerEnabled(env)) return {};
  const missing = NEEDED.filter(k => typeof helpers?.[k] !== 'function');
  if (typeof helpers?.dataDir !== 'string' || !helpers.dataDir) missing.push('dataDir');
  if (typeof helpers?.UNREADABLE !== 'symbol') missing.push('UNREADABLE');
  if (missing.length) throw new Error(`trainer module: server.js no longer passes ${missing.join(', ')}`);
  const { json, readSession, readBody, audit, atomicWrite, sendMediaFile, users, readStateStrict, sendPush } = helpers;

  const dir = storeDir(helpers.dataDir);
  const library = createLibraryStore({ dir, atomicWrite, log });
  const caps = createCapabilities({ dir, atomicWrite, env, now });
  const links = createLinkStore({ dir, atomicWrite, now });
  const assignments = createAssignmentStore({ dir, atomicWrite });
  const limiter = createCodeLimiter({ now });
  // What links add to demo media: the files a trainer's published snapshots still name (kept by
  // the sweep), and who besides the trainer may read one (a linked client, for those files).
  const published = {
    refs(trainer) {
      const doc = links.read();
      if (doc === UNREADABLE) return null;
      const out = [];
      for (const l of doc.links) {
        if (l.trainer !== trainer || !isActive(l)) continue;
        const a = assignments.read(l.id);
        if (a === UNREADABLE) return null;
        for (const p of a.published) for (const c of p.snapshot.customEx || []) if (c.media) out.push(c.media);
      }
      return out;
    },
    clientMayRead(viewer, trainer, hash) {
      const doc = links.read();
      if (doc === UNREADABLE) return false;
      const l = doc.links.find(x => x.client === viewer && x.trainer === trainer && isActive(x));
      if (!l) return false;
      const a = assignments.read(l.id);
      return a !== UNREADABLE && a.published.some(p => snapshotHashes(p.snapshot).has(hash));
    }
  };
  // MEDIA_UPLOADS=0 switches demo uploads off with the rest of the instance's media.
  const demo = trainerMediaLimits(env).enabled ? createDemoMedia({ dir, library, capabilities: caps, published, env, now, log }) : null;
  // Removes demo files that the trainer's readable library has not referenced for the grace
  // period. Only profiles in db.json, and only those whose library reads (see demo-media.js).
  const sweepDemos = () => {
    try {
      const r = demo.store.sweepAll({ uids: users().map(u => u.id) });
      if (r.removed || r.tmp) log.log?.(`trainer media: swept ${r.removed} unreferenced demo file(s), ${r.tmp} stale upload(s)`);
      return r;
    } catch (e) { log.error?.('trainer media: sweep failed', e.message); return null; }
  };
  // The module's data of profiles that were deleted (cleanup.js), before the demo sweep.
  const sweepGone = () => {
    try {
      const r = sweepOrphans({ dir, users, links, assignments, library, demo, capabilities: caps, log });
      const n = r.invites + r.links + r.assignments + r.libraries + r.media + r.capabilities;
      if (n) log.log?.(`trainer: removed data of deleted profiles (${r.links} link(s), ${r.invites} invite(s), ${r.assignments} assignment(s), ${r.libraries} librar(ies), ${r.media} demo folder(s))`);
      return r;
    } catch (e) { log.error?.('trainer: cleanup failed', e.message); return null; }
  };
  const sweep = () => { sweepGone(); if (demo) sweepDemos(); };
  // Leftovers of uploads the previous process was receiving when it stopped.
  if (demo) { try { demo.store.cleanTmp(); } catch (e) { log.error?.('trainer media: boot cleanup failed', e.message); } }
  // The same rhythm as upstream's own sweep: hourly, and once a few minutes after boot.
  if (timers) {
    setInterval(sweep, HOUR).unref();
    setTimeout(sweep, 5 * 60000).unref();
  }
  if (internals) Object.assign(internals, { library, capabilities: caps, links, assignments, limiter, demo, sweepDemos: demo ? sweepDemos : null, sweepGone });

  const note = (req, ev, uid, msg, ok = true) => audit(req, ev, { uid, msg, ok });

  // A signed-in user with trainer tools on, or null after answering. `ev` names the refusal in the
  // audit log; reads are not recorded (switched off, a trainer only reaches their own library).
  function trainerOf(req, res, ev) {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    if (!caps.enabled(user.id)) {
      if (ev) note(req, ev, user.id, 'trainer tools off', false);
      json(res, 403, { error: 'trainer tools are off', code: 'trainer-off' });
      return null;
    }
    return user;
  }

  // What change() came back with, as an answer. True when the write went through.
  function answered(res, out) {
    if (out.status === 400) { json(res, 400, { error: 'baseRev is required', code: out.code }); return false; }
    if (out.status === 503) { json(res, 503, { error: 'the trainer library cannot be read', code: out.code }); return false; }
    if (out.status === 409) { json(res, 409, { error: 'conflict', code: 'conflict', rev: out.doc.rev, wid: out.doc.wid, library: out.doc }); return false; }
    return true;
  }
  // A refusal of what the app sent (LibraryError), answered and recorded; anything else is a bug.
  function refused(req, res, uid, ev, e) {
    if (!(e instanceof LibraryError)) throw e;
    note(req, ev, uid, `${e.code}${e.field ? ' ' + e.field : ''}`, false);
    const status = e.code === 'not-found' ? 404 : 400;
    json(res, status, { error: e.message, code: e.code, field: e.field, ...e.extra });
  }
  const afterWrite = (uid, doc) => { if (demo) demo.noteLibrary(uid, doc); };

  // The id and revision a write names: from the body, or from the query string (DELETE).
  async function args(req) {
    const body = await readBody(req);
    const q = query(req);
    return {
      body,
      id: typeof body.id === 'string' ? body.id : q.get('id'),
      base: {
        baseRev: body.baseRev !== undefined ? body.baseRev : intParam(q.get('baseRev')),
        baseWid: typeof body.baseWid === 'string' ? body.baseWid : (q.get('baseWid') || undefined)
      }
    };
  }
  const find = (list, id, re) => {
    const i = typeof id === 'string' && re.test(id) ? list.findIndex(x => x.id === id) : -1;
    if (i < 0) throw new LibraryError('not-found', 'id');
    return i;
  };

  const routes = {
    // Whether this server runs the module, and which version. Signed in only, like the Coach's
    // disclosure: on an invite-only instance that is nobody's business who has not been let in.
    'GET /api/trainer/status': async (req, res) => {
      if (!readSession(req)) return json(res, 401, { error: 'not signed in' });
      json(res, 200, { enabled: true, module: MODULE_VERSION });
    },

    /* ---------- capability ---------- */
    'GET /api/trainer/capability': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      // `restricted`: TRAINER_ALLOW names who may be a trainer here; Home's card offers set-up only then.
      json(res, 200, { enabled: caps.enabled(user.id), allowed: caps.mayEnable(user.id), restricted: caps.restricted });
    },
    'POST /api/trainer/capability': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled must be true or false', code: 'invalid' });
      const out = caps.set(user.id, body.enabled);
      if (out.status === 403) {
        note(req, 'trainer.capability', user.id, 'refused: not in TRAINER_ALLOW', false);
        return json(res, 403, { error: 'trainer tools are not available to this account', code: out.code });
      }
      if (out.status === 503) return json(res, 503, { error: 'trainer settings cannot be read', code: out.code });
      if (!out.unchanged) note(req, 'trainer.capability', user.id, out.enabled ? 'on' : 'off');
      json(res, 200, { enabled: out.enabled, allowed: caps.mayEnable(user.id) });
    },

    /* ---------- library ---------- */
    'GET /api/trainer/library': async (req, res) => {
      const user = trainerOf(req, res);
      if (!user) return;
      const doc = library.read(user.id);
      if (doc === UNREADABLE) return json(res, 503, { error: 'the trainer library cannot be read', code: 'unreadable' });
      const media = demo ? { usage: demo.store.usage(user.id), limits: pickLimits(demo.limits) } : null;
      json(res, 200, { ...doc, owner: user.id, media });
    },
    'GET /api/trainer/library/export': async (req, res) => {
      const user = trainerOf(req, res);
      if (!user) return;
      const doc = library.read(user.id);
      if (doc === UNREADABLE) return json(res, 503, { error: 'the trainer library cannot be read', code: 'unreadable' });
      json(res, 200, exportLibrary(doc, { now: now(), module: MODULE_VERSION }),
        { 'Content-Disposition': 'attachment; filename="opengym-trainer-library.json"' });
    },

    'POST /api/trainer/library/exercises': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.exercise.denied');
      if (!user) return;
      const { body, base } = await args(req);
      let out;
      try {
        out = library.change(user.id, base, draft => {
          const content = cleanExerciseInput(body.exercise);
          if (draft.exercises.length >= LIMITS.exercises) throw new LibraryError('too-many', 'exercises', { max: LIMITS.exercises });
          const t = now();
          const exercise = exerciseRecord({ id: newId('tx'), rev: 1, archived: false, createdAt: t, updatedAt: t }, content);
          draft.exercises.push(exercise);
          return { created: true, exercise };
        });
      } catch (e) { return refused(req, res, user.id, 'trainer.exercise.refused', e); }
      if (!answered(res, out)) return;
      const ex = out.result.exercise;
      note(req, 'trainer.exercise.create', user.id, `${ex.id} rev ${ex.rev}, ${mediaHashes(ex.media).length} media file(s)`);
      afterWrite(user.id, out.doc);
      json(res, 201, { ok: true, rev: out.doc.rev, wid: out.doc.wid, exercise: ex });
    },
    'PUT /api/trainer/library/exercises': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.exercise.denied');
      if (!user) return;
      const { body, id, base } = await args(req);
      let out;
      try {
        out = library.change(user.id, base, draft => {
          const i = find(draft.exercises, id, EX_ID_RE);
          const cur = draft.exercises[i];
          const content = cleanExerciseInput(body.exercise);
          const restore = body.archived === false && cur.archived;
          const changed = !sameExerciseContent(cur, content);
          if (!changed && !restore) return { unchanged: true, exercise: cur };
          // A content change is a new revision of the exercise: what a client's snapshot records
          // (src.exRev) to tell the version it holds from the library's current one.
          const exercise = exerciseRecord({ ...cur, rev: changed ? cur.rev + 1 : cur.rev, archived: restore ? false : cur.archived, updatedAt: now() }, content);
          draft.exercises[i] = exercise;
          return { exercise, changed, restore };
        });
      } catch (e) { return refused(req, res, user.id, 'trainer.exercise.refused', e); }
      if (!answered(res, out)) return;
      const ex = out.result.exercise;
      if (!out.result.unchanged) {
        note(req, out.result.changed ? 'trainer.exercise.update' : 'trainer.exercise.restore', user.id, `${ex.id} rev ${ex.rev}, ${mediaHashes(ex.media).length} media file(s)`);
        afterWrite(user.id, out.doc);
      }
      json(res, 200, { ok: true, rev: out.doc.rev, wid: out.doc.wid, exercise: ex });
    },
    // Archived, never deleted: programmes and client snapshots that use it keep working, and its
    // demo stays referenced, so the media sweep keeps it.
    'DELETE /api/trainer/library/exercises': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.exercise.denied');
      if (!user) return;
      const { id, base } = await args(req);
      let out;
      try {
        out = library.change(user.id, base, draft => {
          const i = find(draft.exercises, id, EX_ID_RE);
          if (draft.exercises[i].archived) return { unchanged: true, exercise: draft.exercises[i] };
          draft.exercises[i] = { ...draft.exercises[i], archived: true, updatedAt: now() };
          return { exercise: draft.exercises[i] };
        });
      } catch (e) { return refused(req, res, user.id, 'trainer.exercise.refused', e); }
      if (!answered(res, out)) return;
      const ex = out.result.exercise;
      if (!out.result.unchanged) {
        const using = out.doc.programmes.filter(p => programmeExerciseIds(p).has(ex.id)).length;
        note(req, 'trainer.exercise.archive', user.id, `${ex.id} rev ${ex.rev}, used by ${using} programme(s)`);
        afterWrite(user.id, out.doc);
      }
      json(res, 200, { ok: true, rev: out.doc.rev, wid: out.doc.wid, exercise: ex });
    },

    'POST /api/trainer/library/programmes': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.programme.denied');
      if (!user) return;
      const { body, base } = await args(req);
      let out;
      try {
        out = library.change(user.id, base, draft => {
          const content = cleanProgrammeInput(body.programme, { exercises: byId(draft.exercises) });
          if (draft.programmes.length >= LIMITS.programmes) throw new LibraryError('too-many', 'programmes', { max: LIMITS.programmes });
          const t = now();
          const programme = programmeRecord({ id: newId('tp'), rev: 1, archived: false, createdAt: t, updatedAt: t }, content);
          draft.programmes.push(programme);
          return { created: true, programme };
        });
      } catch (e) { return refused(req, res, user.id, 'trainer.programme.refused', e); }
      if (!answered(res, out)) return;
      const p = out.result.programme;
      note(req, 'trainer.programme.create', user.id, programmeLine(p));
      json(res, 201, { ok: true, rev: out.doc.rev, wid: out.doc.wid, programme: p });
    },
    'PUT /api/trainer/library/programmes': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.programme.denied');
      if (!user) return;
      const { body, id, base } = await args(req);
      let out;
      try {
        out = library.change(user.id, base, draft => {
          const i = find(draft.programmes, id, PROG_ID_RE);
          const cur = draft.programmes[i];
          // An exercise archived after this programme started using it stays usable here; a newly
          // added slot has to name one that is not archived.
          const content = cleanProgrammeInput(body.programme, { exercises: byId(draft.exercises), allowArchived: programmeExerciseIds(cur) });
          const restore = body.archived === false && cur.archived;
          const changed = !sameProgrammeContent(cur, content);
          if (!changed && !restore) return { unchanged: true, programme: cur };
          const programme = programmeRecord({ ...cur, rev: changed ? cur.rev + 1 : cur.rev, archived: restore ? false : cur.archived, updatedAt: now() }, content);
          draft.programmes[i] = programme;
          return { programme, changed, restore };
        });
      } catch (e) { return refused(req, res, user.id, 'trainer.programme.refused', e); }
      if (!answered(res, out)) return;
      const p = out.result.programme;
      if (!out.result.unchanged) note(req, out.result.changed ? 'trainer.programme.update' : 'trainer.programme.restore', user.id, programmeLine(p));
      json(res, 200, { ok: true, rev: out.doc.rev, wid: out.doc.wid, programme: p });
    },
    'DELETE /api/trainer/library/programmes': async (req, res) => {
      const user = trainerOf(req, res, 'trainer.programme.denied');
      if (!user) return;
      const { id, base } = await args(req);
      let out;
      try {
        out = library.change(user.id, base, draft => {
          const i = find(draft.programmes, id, PROG_ID_RE);
          if (draft.programmes[i].archived) return { unchanged: true, programme: draft.programmes[i] };
          draft.programmes[i] = { ...draft.programmes[i], archived: true, updatedAt: now() };
          return { programme: draft.programmes[i] };
        });
      } catch (e) { return refused(req, res, user.id, 'trainer.programme.refused', e); }
      if (!answered(res, out)) return;
      const p = out.result.programme;
      if (!out.result.unchanged) note(req, 'trainer.programme.archive', user.id, programmeLine(p));
      json(res, 200, { ok: true, rev: out.doc.rev, wid: out.doc.wid, programme: p });
    }
  };

  Object.assign(routes, linkRoutes({
    json, readSession, readBody, note, now, trainerOf, log,
    // While the instance takes passwords (and so sign-in e-mails), a link needs one on both sides.
    emailRequired: /^(1|true|yes|on)$/i.test(env.PASSWORD_LOGIN || ''),
    caps, library, links, assignments, limiter, demo, users, readStateStrict, stateUnreadable: helpers.UNREADABLE, sendPush
  }));

  if (!demo) return routes;

  /* ---------- demo media (under /api/media/, see the header) ---------- */
  routes['PUT /api/media/trainer'] = async (req, res) => {
    const user = readSession(req);
    if (!user) { demo.store.discard(req); return json(res, 401, { error: 'not signed in' }); }
    if (!caps.enabled(user.id)) {
      demo.store.discard(req);
      note(req, 'trainer.media.denied', user.id, 'upload: trainer tools off', false);
      return json(res, 403, { error: 'trainer tools are off', code: 'trainer-off' });
    }
    // As upstream's upload route: a signed-in upload that was let in may take the half hour;
    // media.js's own idle timer cuts a stalled one.
    req.allowSlowBody?.();
    const hash = query(req).get('hash') || '';
    let r;
    try { r = await demo.store.receive(user.id, hash, req); }
    catch (e) {
      if (e instanceof MediaError) note(req, 'trainer.media.refused', user.id, `${e.code} ${HASH_RE.test(hash) ? hash.slice(0, 12) : '-'}`, false);
      throw e;
    }
    if (!r.body.existed) note(req, 'trainer.media.upload', user.id, `${hash.slice(0, 12)} ${r.body.size} bytes`);
    json(res, r.status, { ...r.body, usage: demo.store.usage(user.id) });
  };
  routes['GET /api/media/trainer'] = async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const q = query(req);
    const hash = q.get('hash') || '';
    const owner = q.get('trainer') || user.id;
    if (!HASH_RE.test(hash)) throw new MediaError(400, 'bad-request');
    // Not allowed and not there are the same answer, so nobody learns whether a file exists.
    if (!demo.canReadDemo(user.id, owner, hash)) {
      if (owner !== user.id) note(req, 'trainer.media.denied', user.id, `read ${hash.slice(0, 12)}`, false);
      throw new MediaError(404, 'media-missing');
    }
    const f = demo.store.file(owner, hash);
    if (!f) throw new MediaError(404, 'media-missing');
    await sendMediaFile(res, f, hash);
  };
  return routes;
}

const byId = list => new Map(list.map(x => [x.id, x]));
const programmeLine = p => `${p.id} rev ${p.rev}, ${p.routines.length} routine(s), ${p.routines.reduce((n, r) => n + r.ex.length, 0)} slot(s)`;
const pickLimits = l => ({ quotaMB: l.quotaMB, imageMB: l.imageMB, gifMB: l.gifMB, videoMB: l.videoMB, videoSec: l.videoSec });

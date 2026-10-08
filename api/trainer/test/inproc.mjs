/* The module's routes in-process, against stand-ins for server.js's helpers that behave like the
 * real ones where the module relies on them: json() answers, readSession() is a uid on the
 * request, readBody() parses JSON, audit() records, atomicWrite() writes a temporary file and
 * renames it, sendMediaFile() reads the file, readStateStrict() reads state-<uid>.json the way
 * server.js does (null when missing, UNREADABLE when it does not parse), sendPush() records.
 * Errors are answered the way server.js's catch-all answers them (a MediaError with its status
 * and code). The clock is injected, so retention can be walked through days without waiting. The
 * real server.js is in server.test.js. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { MediaError } from '../../media.js';
import { trainerRoutes } from '../routes.js';
import { LINK_ROUTES } from '../link-routes.js';

export const quiet = { log() {}, warn() {}, error() {} };
/** Every route the module registers when it is on (and media uploads are). */
export const ROUTES = [
  'GET /api/trainer/status',
  'GET /api/trainer/capability', 'POST /api/trainer/capability',
  'GET /api/trainer/library', 'GET /api/trainer/library/export',
  'POST /api/trainer/library/exercises', 'PUT /api/trainer/library/exercises', 'DELETE /api/trainer/library/exercises',
  'POST /api/trainer/library/programmes', 'PUT /api/trainer/library/programmes', 'DELETE /api/trainer/library/programmes',
  'PUT /api/media/trainer', 'GET /api/media/trainer',
  ...LINK_ROUTES
];
/** server.js's own marker for a state file that does not parse (a stand-in: the module only ever
 *  compares with the one it is handed). */
export const STATE_UNREADABLE = Symbol('unreadable');
export const DAY = 86400000;

export function harness(t, { env = {}, uids = ['u_anna', 'u_bea', 'u_cat'], dataDir } = {}) {
  uids = [...uids];
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-inproc-'));
  if (!dataDir) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { t: 1_800_000_000_000 };
  const audits = [];
  const pushes = [];
  const stateFile = uid => path.join(dir, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
  const helpers = {
    json(res, code, obj, headers) { res.status = code; res.body = obj; res.headers = headers || {}; },
    readSession: req => (req.uid ? { id: req.uid, name: 'Name of ' + req.uid } : null),
    async readBody(req) {
      const chunks = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      if (!chunks.length) return {};
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('invalid json'), { status: 400 });
      return body;
    },
    audit: (req, ev, f = {}) => audits.push({ ev, ...f }),
    atomicWrite(file, content, mode) {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, content, mode == null ? undefined : { mode });
      fs.renameSync(tmp, file);
    },
    dataDir: dir,
    async sendMediaFile(res, f, hash) {
      res.status = 200;
      res.headers = { 'Content-Type': f.mime };
      res.bytes = fs.readFileSync(f.path);
      res.hash = hash;
    },
    users: () => uids.map(id => ({ id, name: 'Name of ' + id })),
    readStateStrict(uid) {
      let raw;
      try { raw = fs.readFileSync(stateFile(uid), 'utf8'); }
      catch (e) { return e.code === 'ENOENT' ? null : STATE_UNREADABLE; }
      try { return JSON.parse(raw); } catch { return STATE_UNREADABLE; }
    },
    UNREADABLE: STATE_UNREADABLE,
    async sendPush(uid, payload) { pushes.push({ uid, ...payload }); }
  };
  /** Writes a client's state file, as PUT /api/data would have left it (tests only). */
  const writeState = (uid, S) => fs.writeFileSync(stateFile(uid), JSON.stringify(S));
  const internals = {};
  const routes = trainerRoutes(helpers, { TRAINER: '1', MEDIA_MIN_FREE_MB: '0', ...env }, { now: () => clock.t, timers: false, log: quiet, internals });

  async function call(method, url, { uid, body, upload } = {}) {
    const key = method + ' ' + new URL(url, 'http://x').pathname;
    const req = upload
      ? Object.assign(Readable.from([upload.bytes], { objectMode: false }), { headers: { 'content-type': upload.mime, 'content-length': String(upload.bytes.length) } })
      : Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))], { objectMode: false }), { headers: {} });
    Object.assign(req, { method, url, uid });
    const res = { status: null, body: null, headers: {} };
    const handler = routes[key];
    if (!handler) return { status: 404, body: { error: 'not found' } };
    try { await handler(req, res); }
    catch (e) {
      if (e instanceof MediaError) return { status: e.status, body: { error: e.message, code: e.code, ...e.extra } };
      if (e?.status) return { status: e.status, body: { error: e.message } };
      throw e;
    }
    return res;
  }
  const on = uid => call('POST', '/api/trainer/capability', { uid, body: { enabled: true } });
  return { dir, clock, audits, pushes, helpers, routes, internals, uids, call, on, writeState, stateFile };
}

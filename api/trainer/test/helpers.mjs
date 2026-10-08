/* Scaffolding for the trainer module's api tests: the real server.js in a child process, in a
 * data directory of its own, with a session cookie minted the way server.js signs one.
 *
 * Kept here rather than imported from api/test/helpers.mjs: that file is upstream's, and the
 * module's tests should only break when the server's behaviour changes, not its test helpers.
 * Run with: cd api && node --test trainer/test/*.test.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = crypto.randomBytes(32).toString('hex');

/** A session cookie for `uid`, signed with this file's secret (server.js makeSession). */
export function cookieFor(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

/** The port the child bound: it picks its own (PORT=0) and names it on its boot line. */
function boundPort(child, tail) {
  return new Promise((resolve, reject) => {
    let seen = '';
    const give = setTimeout(() => reject(new Error(`server never announced a port:\n${tail()}`)), 20000);
    const look = d => {
      seen += d;
      const m = /gym-api on :(\d+)/.exec(seen);
      if (!m) return;
      clearTimeout(give);
      child.stdout.off('data', look);
      resolve(+m[1]);
    };
    child.stdout.on('data', look);
    child.once('exit', code => { clearTimeout(give); reject(new Error(`server exited (${code}):\n${tail()}`)); });
  });
}

/** server.js with `env` on top of a fresh data directory holding `users`. Killed after the test. */
export async function startServer(t, { env = {}, users = [{ id: 'u_one', name: 'One' }] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-trainer-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: users.map(u => ({ created: new Date().toISOString(), ...u })), creds: [], subs: [], invites: []
  }));
  const base = { ...process.env };
  delete base.TRAINER;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...base, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env }
  });
  const h = { dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (method, p, { uid, body } = {}) => {
    const r = await fetch(h.api + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: cookieFor(uid) } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    let data = null;
    try { data = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, body: data };
  };
  /** A request with a raw body (an upload) or for a raw answer (a file): status, headers, bytes. */
  h.raw = async (method, p, { uid, bytes, mime } = {}) => {
    const r = await fetch(h.api + p, {
      method,
      headers: { ...(mime ? { 'Content-Type': mime } : {}), ...(uid ? { Cookie: cookieFor(uid) } : {}) },
      ...(bytes ? { body: bytes } : {})
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* a file */ }
    return { status: r.status, headers: r.headers, bytes: buf, body: json };
  };
  /** The audit log's records, oldest first. */
  h.audit = () => {
    try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
    catch { return []; }
  };
  return h;
}

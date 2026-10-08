/* The seam on the server side (dozzly/README.md, "The seam"), read from the source the way
 * upstream's own dockerfile-copy and openapi-routes tests read theirs. A rebase that lost a hook
 * line, or an upstream rename of a helper the seam hands over, fails here by name rather than as
 * a server that boots without the module or does not boot at all. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { API } from './helpers.mjs';

const read = f => fs.readFileSync(path.join(API, f), 'utf8');
const server = read('server.js');

test('server.js imports the module once, beside the Coach', () => {
  const lines = server.split('\n');
  const at = lines.indexOf("import { trainerRoutes } from './trainer/routes.js';");
  assert.ok(at > 0, 'the import line');
  assert.equal(lines.filter(l => l.includes("from './trainer/routes.js'")).length, 1);
  assert.equal(lines[at - 1], "import { coachRoutes } from './coach/routes.js';");
});

test('the route spread sits in the route table, on the line before the Coach\'s', () => {
  const lines = server.split('\n');
  const at = lines.findIndex(l => l.startsWith('  ...trainerRoutes({'));
  assert.ok(at > 0, 'the spread line');
  assert.equal(lines.filter(l => l.includes('...trainerRoutes(')).length, 1);
  assert.match(lines[at + 1], /^ {2}\.\.\.coachRoutes\(/);
  assert.ok(at > lines.indexOf('const routes = {'), 'inside the route table');
});

test('every helper the seam hands over is declared in server.js before the route table', () => {
  const call = /^ {2}\.\.\.trainerRoutes\(\{ (.*) \}\),$/m.exec(server);
  assert.ok(call, 'the spread passes one object literal');
  const table = server.indexOf('\nconst routes = {');
  const head = server.slice(0, table);
  // `name` or `key: expression`; every identifier the expressions use must exist above.
  const names = new Set();
  for (const part of call[1].split(/,\s*(?![^()]*\))/)) {
    const expr = part.includes(':') ? part.slice(part.indexOf(':') + 1) : part;
    for (const id of expr.match(/[A-Za-z_$][\w$]*/g) || []) names.add(id);
  }
  for (const k of ['null', 'db', 'users']) names.delete(k);   // literals, and the getter's own names
  assert.ok(names.size >= 10, `only ${[...names].join(', ')}`);
  for (const id of names) {
    const declared = new RegExp(`^(?:const|let|function|async function|class) ${id.replace('$', '\\$')}\\b`, 'm').test(head);
    assert.ok(declared, `${id} is passed to trainerRoutes but not declared above the route table in server.js`);
  }
  assert.match(head, /^let db = /m, 'users() reads the live db');
});

test('the api image copies the module directory right after the Coach\'s', () => {
  const lines = read('Dockerfile').split('\n');
  const at = lines.indexOf('COPY trainer ./trainer');
  assert.ok(at > 0, 'the COPY line');
  assert.equal(lines[at - 1], 'COPY coach ./coach');
});

test('upstream\'s route list and spec stay upstream\'s: no /api/trainer key in server.js or openapi.yaml', () => {
  assert.doesNotMatch(server, /'(GET|POST|PUT|DELETE) \/api\/trainer\//);
  assert.doesNotMatch(read('openapi.yaml'), /\/api\/trainer\//);
});

/* ---------- what the demo media routes stand on (FIT-003) ---------- */

test('the seam hands over sendMediaFile, audit, atomicWrite, dataDir and users(), which the module calls', () => {
  const call = /^ {2}\.\.\.trainerRoutes\(\{ (.*) \}\),$/m.exec(server)[1];
  for (const k of ['json', 'readBody', 'readSession', 'audit', 'atomicWrite', 'dataDir: DATA', 'sendMediaFile', 'users: () => db.users']) {
    assert.ok(call.split(/,\s*/).includes(k), k);
  }
  // sendMediaFile(res, f, hash) streams a stored file with the hardened headers the module relies
  // on for demo files: the file's own type, nosniff, a sandbox CSP, same-origin CORP, no-store.
  const fn = server.slice(server.indexOf('async function sendMediaFile(res, f, hash) {'));
  assert.ok(fn.length < server.length, 'sendMediaFile(res, f, hash)');
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  for (const h of ["'Content-Type': f.mime", "'X-Content-Type-Options': 'nosniff'", "'Content-Security-Policy': \"default-src 'none'; sandbox\"", "'Cross-Origin-Resource-Policy': 'same-origin'", "'Cache-Control': 'private, no-store'"]) {
    assert.ok(body.includes(h), h);
  }
  // audit(req, ev, f) records f.uid, f.msg and f.ok as the module passes them.
  const audit = server.slice(server.indexOf('function audit(req, ev, f = {}) {'));
  for (const s of ['if (f.uid) rec.uid = f.uid;', 'if (f.msg) rec.msg = String(f.msg)', "ok: f.ok !== false"]) assert.ok(audit.slice(0, 1200).includes(s), s);
});

test('the dispatcher: an exact-path lookup, with /api/media/<64 hex> the only pattern, so /api/media/trainer reaches the module', () => {
  assert.match(server, /let key = req\.method \+ ' ' \+ url\.pathname;/);
  assert.match(server, /const mm = \/\^\\\/api\\\/media\\\/\(\[0-9a-f\]\{64\}\)\$\/\.exec\(url\.pathname\);/);
  assert.match(server, /const handler = routes\[key\];/);
  // The module's routes are spread before the media routes, and no upstream key is /api/media/trainer.
  assert.doesNotMatch(server, /'(GET|PUT) \/api\/media\/trainer'/);
  // An upload let in may lift the five-minute body deadline, as upstream's own upload route does.
  assert.match(server, /req\.allowSlowBody = clear;/);
  assert.match(server, /MediaError\) \{\n\s+if \(!res\.headersSent\) json\(res, e\.status, \{ error: e\.message, code: e\.code, \.\.\.e\.extra \}, e\.headers\);/);
});

test('nginx lets large, unbuffered bodies through under /api/media/ only, which is why the demo routes live there', () => {
  const nginx = fs.readFileSync(path.join(API, '..', 'web', 'nginx.conf.template'), 'utf8');
  const block = nginx.slice(nginx.indexOf('location ^~ ${BASE_PATH}/api/media/ {'));
  assert.ok(block.length < nginx.length, 'the /api/media/ location');
  const body = block.slice(0, block.indexOf('\n    }\n'));
  assert.match(body, /client_max_body_size \$\{MEDIA_UPLOAD_MAX\};/);
  assert.match(body, /proxy_request_buffering off;/);
  const api = nginx.slice(nginx.indexOf('location ^~ ${BASE_PATH}/api/ {'));
  assert.match(api.slice(0, api.indexOf('\n    }\n')), /client_max_body_size 5m;/);
});

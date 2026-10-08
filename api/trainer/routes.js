/* HTTP surface of the trainer module (dozzly/opengym fork, ADR 029).
 *
 * Written as a factory taking server.js's own helpers, the way coach/routes.js is: they are
 * closures over the db and the session secret, and passing them in keeps this module free of an
 * import cycle and testable against fakes. server.js hands over one object with everything the
 * module is expected to need (api/server.js, the `...trainerRoutes({ … })` line), so that line
 * does not have to change each time the module starts using one more of them.
 *
 * Off unless TRAINER is set (1, true, yes or on). Off, the factory returns no routes at all and
 * every /api/trainer/* path is the server's plain 404: what an upstream build answers, and what
 * the app reads as "this server has no trainer module".
 *
 * What it will never do (ADR 029, decision 4): write a `state-<uid>.json`, `db.json` or another
 * profile's upload folder. Its own data goes under DATA_DIR/trainer/ (storeDir), written with the
 * server's atomicWrite. Nothing is created there yet.
 */
import path from 'node:path';

export const MODULE_VERSION = '0.1.0';

const ON = /^(1|true|yes|on)$/i;
export const trainerEnabled = (env = process.env) => ON.test(env.TRAINER || '');

/** The module's own store. Upstream never reads or writes it; deleting it removes the module's data. */
export const storeDir = dataDir => path.join(dataDir, 'trainer');

// The helpers the routes below call. Checked once at boot so a helper that upstream renamed or
// dropped stops the server with a clear message instead of failing on the first request.
const NEEDED = ['json', 'readSession'];

export function trainerRoutes(helpers, env = process.env) {
  if (!trainerEnabled(env)) return {};
  const missing = NEEDED.filter(k => typeof helpers?.[k] !== 'function');
  if (missing.length) throw new Error(`trainer module: server.js no longer passes ${missing.join(', ')}`);
  const { json, readSession } = helpers;

  return {
    // Whether this server runs the module, and which version. Signed in only, like the Coach's
    // disclosure: on an invite-only instance that is nobody's business who has not been let in.
    'GET /api/trainer/status': async (req, res) => {
      if (!readSession(req)) return json(res, 401, { error: 'not signed in' });
      json(res, 200, { enabled: true, module: MODULE_VERSION });
    }
  };
}

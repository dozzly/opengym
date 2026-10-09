/* A structured run (dozzly/opengym, roadmap FIT-009): what the trainer plans as steps, and the
 * text the client reads. Information only: no GPS, no live guidance, no watch export. The library
 * keeps the steps on the slot (`run`); a published snapshot carries only the text, as the slot's
 * instructions (`note`), which upstream's workout screen shows (snapshot.js).
 *
 *   run    { steps: [step] }                                         1 to 10 steps
 *   step   { kind, km | sec, target? }                               kind: one of KINDS
 *          { kind: 'repeat', times, work: { km | sec, target? }, rest?: { km | sec, how } }
 *   target { pace, paceTo? } (seconds per km) | { kmh } | { zone } (heart-rate zone 1 to 5)
 *
 * A port of frontend/src/trainer/run.js; frontend/src/trainer/run-parity.test.js runs both over the
 * same inputs and wants the same answers. Pure.
 */

export const RUN_LIMITS = Object.freeze({ steps: 10, km: 100, sec: 36000, times: 50, paceMin: 120, paceMax: 1200, kmh: 60 });
export const KINDS = Object.freeze(['warmup', 'easy', 'steady', 'tempo', 'fast', 'recovery', 'cooldown']);
export const REST_HOW = Object.freeze(['jog', 'walk', 'rest']);

export class RunError extends Error {
  constructor(field) {
    super(`invalid: ${field}`);
    this.code = 'invalid';
    this.field = field;
  }
}
const bad = field => { throw new RunError(field); };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** A distance or a duration, exactly one of them: { km } or { sec }. */
function amount(raw, field) {
  const hasKm = raw.km != null, hasSec = raw.sec != null;
  if (hasKm === hasSec) bad(field);
  if (hasKm) {
    if (!isNum(raw.km) || raw.km <= 0 || raw.km > RUN_LIMITS.km) bad(`${field}.km`);
    const km = Math.round(raw.km * 100) / 100;
    if (km <= 0) bad(`${field}.km`);
    return { km };
  }
  if (!isInt(raw.sec, 1, RUN_LIMITS.sec)) bad(`${field}.sec`);
  return { sec: raw.sec };
}

function target(raw, field) {
  if (raw == null) return null;
  if (!isObj(raw)) bad(field);
  const kinds = ['pace', 'kmh', 'zone'].filter(k => raw[k] != null);
  if (kinds.length !== 1) bad(field);
  if (kinds[0] === 'pace') {
    if (!isInt(raw.pace, RUN_LIMITS.paceMin, RUN_LIMITS.paceMax)) bad(`${field}.pace`);
    if (raw.paceTo == null) return { pace: raw.pace };
    if (!isInt(raw.paceTo, raw.pace + 1, RUN_LIMITS.paceMax)) bad(`${field}.paceTo`);
    return { pace: raw.pace, paceTo: raw.paceTo };
  }
  if (kinds[0] === 'kmh') {
    if (!isNum(raw.kmh) || raw.kmh < 1 || raw.kmh > RUN_LIMITS.kmh) bad(`${field}.kmh`);
    return { kmh: Math.round(raw.kmh * 10) / 10 };
  }
  if (!isInt(raw.zone, 1, 5)) bad(`${field}.zone`);
  return { zone: raw.zone };
}

/** A run as the library stores it, rebuilt from the fields named above; null for none. Throws
 *  RunError with the path of what is wrong, under `field`. */
export function cleanRun(raw, field = 'run') {
  if (raw == null) return null;
  if (!isObj(raw) || !Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > RUN_LIMITS.steps) bad(field);
  const steps = raw.steps.map((s, i) => {
    const f = `${field}.steps.${i}`;
    if (!isObj(s)) bad(f);
    if (s.kind === 'repeat') {
      if (!isInt(s.times, 2, RUN_LIMITS.times)) bad(`${f}.times`);
      if (!isObj(s.work)) bad(`${f}.work`);
      const work = amount(s.work, `${f}.work`);
      const t = target(s.work.target, `${f}.work.target`);
      if (t) work.target = t;
      const out = { kind: 'repeat', times: s.times, work };
      if (s.rest != null) {
        if (!isObj(s.rest) || !REST_HOW.includes(s.rest.how)) bad(`${f}.rest`);
        out.rest = { ...amount(s.rest, `${f}.rest`), how: s.rest.how };
      }
      return out;
    }
    if (!KINDS.includes(s.kind)) bad(`${f}.kind`);
    const out = { kind: s.kind, ...amount(s, f) };
    const t = target(s.target, `${f}.target`);
    if (t) out.target = t;
    return out;
  });
  return { steps };
}

/* ---------------------------------------------------------------- the text the client reads */

const KIND_TEXT = { warmup: 'Warm-up', easy: 'Easy', steady: 'Steady', tempo: 'Tempo', fast: 'Fast', recovery: 'Recovery', cooldown: 'Cool-down' };
const two = n => String(n).padStart(2, '0');
const trim = n => String(Math.round(n * 100) / 100);

export const kmText = km => (km < 1 ? `${Math.round(km * 1000)} m` : `${trim(km)} km`);
export const secText = sec => (sec < 60 || (sec < 120 && sec % 60) ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)}:${two(sec % 60)} min` : `${sec / 60} min`);
export const paceText = sec => `${Math.floor(sec / 60)}:${two(sec % 60)}`;
const amountText = a => (a.km != null ? kmText(a.km) : secText(a.sec));
function targetText(t) {
  if (!t) return '';
  if (t.pace != null) return ` at ${paceText(t.pace)}${t.paceTo != null ? `–${paceText(t.paceTo)}` : ''}/km`;
  if (t.kmh != null) return ` at ${trim(t.kmh)} km/h`;
  return ` in heart-rate zone ${t.zone}`;
}
const REST_TEXT = { jog: 'jog', walk: 'walk', rest: 'rest' };

export function stepText(s) {
  if (s.kind === 'repeat') {
    const rest = s.rest ? `, ${amountText(s.rest)} ${REST_TEXT[s.rest.how]} between` : '';
    return `${s.times} × ${amountText(s.work)}${targetText(s.work.target)}${rest}`;
  }
  return `${KIND_TEXT[s.kind]} ${amountText(s)}${targetText(s.target)}`;
}

export function totalText(run) {
  let km = 0, sec = 0;
  const add = (a, n = 1) => { if (a.km != null) km += a.km * n; else sec += a.sec * n; };
  for (const s of run.steps) {
    if (s.kind === 'repeat') { add(s.work, s.times); if (s.rest) add(s.rest, s.times); } else add(s);
  }
  km = Math.round(km * 100) / 100;
  return 'Total: ' + [km ? kmText(km) : '', sec ? secText(sec) : ''].filter(Boolean).join(' + ');
}

export function runText(run) {
  return [totalText(run), ...run.steps.map((s, i) => `${i + 1}. ${stepText(s)}`)].join('\n');
}

/** What the client's slot says: the run's text, then the trainer's own instructions after a blank
 *  line. A slot without a run keeps its note as it is. */
export function deliveredNote(run, note) {
  if (!run) return note || '';
  return note ? `${runText(run)}\n\n${note}` : runText(run);
}

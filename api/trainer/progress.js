/* What a trainer may read of a linked client's training (scope `read_progress`, FIT-004): a view
 * built from the client's state document, read-only, and filtered down to the routines the link
 * delivered. Pure: the route reads the state (server.js readStateStrict) and hands it here.
 *
 * In it:
 *   - finished workouts on a routine the link delivered (an applied revision's routines and
 *     every retained published snapshot's), finished since the link began, newest first, at most
 *     100;
 *   - per workout: its date, start and duration, the delivered routines' names (the trainer's own
 *     names for them), and per exercise the sets as logged: weight, reps, time, effort (RIR or
 *     RPE) and whether each was done, a warm-up flag, and both sides of a per-side set;
 *   - the client's own notes about that session and its exercises, where upstream keeps them
 *     (`note` on the workout and on each entry);
 *   - the profile's weight unit, without which no weight above can be read;
 *   - body weight (each workout's `bw`, and the weigh-ins since the link began) only when the
 *     client switched sharing it on.
 * Never in it: media refs, photos or videos (a workout's `media`), any other setting, workouts of
 * other routines, personal routines, custom exercises of the client's own (an entry naming one
 * keeps its id, without a name), anything before the link began.
 *
 * A session that combined a delivered routine with one of the client's own shows only the
 * entries of the delivered one (upstream's `rid`); its session note is left out, since it may be
 * about the rest.
 */
import { assignedRoutineIds } from './assignments.js';

export const PROGRESS_MAX = 100;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = v => (Array.isArray(v) ? v : []);
const text = (v, max = 2000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** When a workout happened, in ms: its start, else its end, else its date. */
export function workoutTime(w) {
  return num(w.start) ?? num(w.end) ?? (typeof w.d === 'string' && Number.isFinite(Date.parse(w.d)) ? Date.parse(w.d) : null);
}

/** The routine names the trainer gave them, newest published revision first. */
export function routineNames(assignment) {
  const names = new Map();
  for (const p of [...list(assignment?.published)].reverse()) {
    for (const r of list(p.snapshot?.routines)) if (!names.has(r.id)) names.set(r.id, r.name);
  }
  return names;
}
/** The names of the trainer's exercises the snapshots delivered (tx_ ids), newest first. */
export function exerciseNames(assignment) {
  const names = new Map();
  for (const p of [...list(assignment?.published)].reverse()) {
    for (const c of list(p.snapshot?.customEx)) if (!names.has(c.id)) names.set(c.id, c.n);
  }
  return names;
}

function oneSide(s) {
  if (!isObj(s)) return null;
  const sec = num(s.sec) ?? (num(s.min) != null ? Math.round(num(s.min) * 60) : null);
  return { weight: num(s.w), reps: num(s.r), time: sec };
}
function effortOf(s) {
  if (num(s.rir) != null) return { rir: num(s.rir) };
  if (num(s.rpe) != null) return { rpe: num(s.rpe) };
  return null;
}
/** One logged set: weight, reps, time (seconds), effort, done; the warm-up flag and both sides
 *  of a per-side set when there are. Nothing else of the row (its media, its timestamps). */
export function setView(s) {
  if (!isObj(s)) return null;
  const out = { ...oneSide(s), effort: effortOf(s), done: s.done === true };
  if (s.phase === 'warmup' || (s.phase == null && s.warmup === true)) out.warmup = true;
  if (isObj(s.sides)) out.sides = { L: oneSide(s.sides.L), R: oneSide(s.sides.R) };
  return out;
}

/**
 * The view of `state` (a client's state document, or null) for a link: `assignment` is the link's
 * assignment, `since` when the link began, `shareBodyweight` the client's switch.
 */
export function progressView(state, { assignment, since = 0, shareBodyweight = false, max = PROGRESS_MAX } = {}) {
  const S = isObj(state) ? state : {};
  const delivered = assignedRoutineIds(assignment);
  const rNames = routineNames(assignment);
  const xNames = exerciseNames(assignment);
  const picked = [];
  for (const w of list(S.workouts)) {
    if (!isObj(w)) continue;
    const rids = [...new Set([].concat(Array.isArray(w.routineIds) && w.routineIds.length ? w.routineIds : (w.routineId != null ? [w.routineId] : [])))]
      .filter(x => typeof x === 'string');
    const ours = rids.filter(id => delivered.has(id));
    if (!ours.length) continue;
    const t = workoutTime(w);
    if (t == null || t < since) continue;
    picked.push({ w, t, ours, whole: ours.length === rids.length });
  }
  picked.sort((a, b) => b.t - a.t);
  const workouts = picked.slice(0, max).map(({ w, t, ours, whole }) => {
    const entries = list(w.entries).filter(e => isObj(e) && (e.rid != null ? ours.includes(e.rid) : whole));
    const start = num(w.start), end = num(w.end);
    const out = {
      id: typeof w.id === 'string' || typeof w.id === 'number' ? w.id : null,
      date: typeof w.d === 'string' ? w.d : new Date(t).toISOString().slice(0, 10),
      start,
      duration: start != null && end != null && end >= start ? Math.round((end - start) / 1000) : null,
      routines: ours.map(id => ({ id, name: rNames.get(id) || null })),
      exercises: entries.map(e => {
        const ex = { id: typeof e.id === 'string' ? e.id : String(e.id), name: xNames.get(e.id) || null, sets: list(e.sets).map(setView).filter(Boolean) };
        const note = text(e.note);
        if (note) ex.note = note;
        return ex;
      })
    };
    const note = whole ? text(w.note) : null;
    if (note) out.note = note;
    if (shareBodyweight && num(w.bw) != null) out.bodyweight = num(w.bw);
    return out;
  });
  const view = { unit: S.unit === 'lb' ? 'lb' : 'kg', workouts };
  if (shareBodyweight) {
    view.bodyweight = list(S.bodyweight)
      .filter(e => isObj(e) && typeof e.d === 'string' && num(e.w) != null && (Date.parse(e.d) || 0) >= since - 86400000)
      .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
      .slice(0, max)
      .map(e => ({ d: e.d, w: num(e.w) }));
  }
  return view;
}

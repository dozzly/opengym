// A quick session from the AI Coach (FIT-008), in the app: what the start screen asks, and how a
// session the Coach proposed becomes a workout. The server (api/trainer/quick-session.js) asks the
// Coach and checks the answer with the Coach's own validator; this starts it.
//
// A one-off is upstream's own start (sheets.jsx beginWorkout) with entries built from a routine
// that is never stored: nothing in the plan changes, and the workout is logged like a freestyle
// one, under the session's name. "Keep it" adds the routine to the person's own first, with
// upstream's mergePlan, and starts that, so its history attaches to it.
import { buildSessionEntries, currentProfile, loadSheets, mergePlan, navToWorkout, stopRest, todayISO, toast, uid, updateProfile } from './adapter.js'
import { QUICK_TEXT as T } from './strings.js'

export const MINUTES = Object.freeze([20, 30, 45, 60, 90])
export const FOCUS = Object.freeze(['full', 'upper', 'lower', 'push', 'pull', 'core', 'run', 'climb', 'mobility'])
export const FEELING = Object.freeze(['fresh', 'ok', 'tired', 'sore'])
const FORM_KEY = 'opengym.quick.form'
export const DEFAULT_FORM = Object.freeze({ minutes: 45, focus: 'full', equipment: [], feeling: 'ok', note: '' })

/** The last choices on this device, so the next ask starts from them (the note excepted). */
export function loadForm(store = globalThis.localStorage) {
  try {
    const f = JSON.parse(store?.getItem(FORM_KEY) || 'null')
    if (!f || typeof f !== 'object') return { ...DEFAULT_FORM }
    return {
      minutes: MINUTES.includes(f.minutes) ? f.minutes : DEFAULT_FORM.minutes,
      focus: FOCUS.includes(f.focus) ? f.focus : DEFAULT_FORM.focus,
      equipment: Array.isArray(f.equipment) ? f.equipment.filter(e => typeof e === 'string').slice(0, 12) : [],
      feeling: FEELING.includes(f.feeling) ? f.feeling : DEFAULT_FORM.feeling,
      note: '',
    }
  } catch { return { ...DEFAULT_FORM } }
}
export function saveForm(form, store = globalThis.localStorage) {
  try { store?.setItem(FORM_KEY, JSON.stringify({ ...form, note: '' })) } catch { /* private mode */ }
}

/** The session as a routine the app can start: each exercise's `why`, written to the person,
 *  becomes its instruction (`note`), which the workout screen shows under the exercise. */
export function sessionRoutine(session, id = 'quick') {
  const r = session.routine
  return {
    id, name: session.name, ...(r.emoji ? { emoji: r.emoji } : {}),
    ex: r.ex.map(({ why, ...e }) => ({ ...e, ...(why ? { note: why } : {}) })),
  }
}

/** "3 × 10", "3 × 45 s", "30 min". */
export function prescriptionText(e) {
  if (e.min != null && e.reps == null && e.sec == null) return T.prescription.cardio(e.min)
  if (e.mode === 'time') return T.prescription.time(e.sets, e.sec)
  return T.prescription.reps(e.sets, e.reps)
}

/** Starts `session`: as a one-off, or (`keep`) kept as a routine of the person's own first.
 *  Resolves true when a workout was started (or the weigh-in it waits for was opened). */
export async function startSession(session, { keep = false } = {}) {
  if (currentProfile().active) { toast(T.finishFirst); return false }
  const { bwSheet, startFlow } = await loadSheets()
  const routine = sessionRoutine(session)
  if (keep) {
    let rid = null
    updateProfile(s => {
      const before = new Set(s.routines.map(r => r.id))
      mergePlan(s, { opengym_plan: 1, name: session.name, routines: [{ ...routine, id: 'r1' }], week: {}, customEx: [] }, { schedule: false })
      rid = s.routines.find(r => !before.has(r.id))?.id || null
    })
    if (!rid) return false
    startFlow([rid])
    return true
  }
  const go = bw => {
    if (currentProfile().active) { toast(T.finishFirst); return }
    const entries = buildSessionEntries(currentProfile(), routine)
    updateProfile(s => {
      s.active = {
        id: uid(), d: todayISO(), start: Date.now(), routineIds: [],
        name: session.name, bw: bw || null, cur: 0, entries,
        workoutView: s.workoutView || 'cards',
      }
    })
    stopRest()
    navToWorkout()
    toast(T.oneOff)
  }
  // The weigh-in is a setting; off goes straight in, as upstream's start does.
  if (currentProfile().weighIn === false) go(null)
  else bwSheet({ required: true, onDone: go })
  return true
}

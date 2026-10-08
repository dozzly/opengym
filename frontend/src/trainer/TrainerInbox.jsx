// Always mounted (App.jsx, the seam's inbox line), outside the routed view: where a plan update
// from the client's trainer arrives (ADR 029, decision 5; FIT-004). Nothing unless the server
// reports the module on and someone is signed in.
//
// It asks GET /api/trainer/assignment when it mounts, when the window gets the focus back, when the
// page becomes visible, every 60 seconds while it is, and when the trainer page asks (after Accept
// or a mode switch). A published revision newer than the one last applied or discarded is:
//   - trainer-managed: applied at once (delivery.js apply: an undo copy, the routines, the demo
//     files into the client's own media, the acknowledgement), with a toast that offers Undo;
//   - co-managed: offered on a card with the trainer's note and what Apply would change, and
//     Apply, Discard (acknowledged, nothing changed) or Later (until the next revision or start).
// Neither happens while a workout is running (it waits for the workout to end), nor before the
// store's first pull from the server is done (the inbox starts once it is).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTrainerStatus } from './status.js'
import { Button, currentProfile, toast, useProfileReady, useUser, useWorkoutRunning } from './adapter.js'
import { check, apply, discard, undo, copyDemos, onCheckRequest, workoutRunning, POLL_MS } from './delivery.js'
import { deliverable } from './snapshot.js'
import { diffPlans, heldPlan } from './diff.js'
import DiffList, { exerciseLabel } from './DiffList.jsx'
import { LINK_TEXT as T } from './strings.js'

export default function TrainerInbox() {
  const status = useTrainerStatus()
  const user = useUser()
  const ready = useProfileReady()
  if (!status?.enabled || !user?.id || !ready) return null
  return <Inbox key={user.id} uid={user.id} />
}

/** The toast after an apply, with its Undo. */
function appliedToast(a, out) {
  toast(T.applied(a.link.trainer.name), {
    action: T.undo,
    onAction: () => { undo(out.undo).then(() => toast(T.undone)).catch(() => {}) },
  })
}

function Inbox({ uid }) {
  const running = useWorkoutRunning()
  const [offer, setOffer] = useState(null)      // a co-managed revision waiting for the client
  const [later, setLater] = useState(null)      // `${link}:${rev}` put off with Later
  const [failed, setFailedState] = useState(null)   // `${link}:${rev}` this device could not apply
  const failedRef = useRef(null)
  const setFailed = k => { failedRef.current = k; setFailedState(k) }
  const [busy, setBusy] = useState(false)
  const checking = useRef(false)
  const again = useRef(false)                   // asked again while a check was in flight
  const live = useRef(true)
  const owedCopy = useRef(null)                 // { link, rev, snapshot, trainer } whose demo copy failed

  // One check at a time. One asked for meanwhile (a focus, the trainer page after Accept) runs
  // once more after it: it may be for a revision the check in flight did not see yet.
  const run = useCallback(async () => {
    if (checking.current) { again.current = true; return }
    checking.current = true
    again.current = false
    try {
      const a = await check(uid)
      if (!live.current) return
      if (!a.linked) { setOffer(null); owedCopy.current = null; return }
      const o = owedCopy.current
      if (o && o.link === a.link.id && a.applied?.rev === o.rev && !a.due) {
        const copy = await copyDemos(o.snapshot, o.trainer)
        if (!copy.failed) owedCopy.current = null
      }
      if (!a.due) { setOffer(null); return }
      if (a.link.mode === 'co-managed' || failedRef.current === `${a.link.id}:${a.published.rev}`) { setOffer(a); return }
      if (workoutRunning()) return
      const out = await apply(uid, a)
      if (out.copy.failed) owedCopy.current = { link: a.link.id, rev: a.published.rev, snapshot: a.published.snapshot, trainer: a.link.trainer.id }
      if (!live.current) return
      setOffer(null)
      appliedToast(a, out)
    } catch (e) {
      // A revision this device cannot apply is put on the card, for the client to discard; anything
      // else (offline, a session that ended) waits for the next check.
      if (e?.code === 'id-collision' || e?.code === 'not-snapshot') {
        const a = await check(uid).catch(() => null)
        if (a?.due && live.current) { setFailed(`${a.link.id}:${a.published.rev}`); setOffer(a) }
      }
    } finally {
      checking.current = false
      if (again.current && live.current) { again.current = false; runRef.current() }
    }
  }, [uid])
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    live.current = true
    run()
    const onFocus = () => run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') run() }, POLL_MS)
    const off = onCheckRequest(run)
    return () => {
      live.current = false
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
      off()
    }
  }, [run])
  // A workout that ends lets a held-back update through.
  const wasRunning = useRef(running)
  useEffect(() => { if (wasRunning.current && !running) run(); wasRunning.current = running }, [running, run])

  if (!offer || running || later === `${offer.link.id}:${offer.published.rev}`) return null
  const key = `${offer.link.id}:${offer.published.rev}`

  const onApply = async () => {
    setBusy(true)
    try {
      const out = await apply(uid, offer)
      if (out.copy.failed) owedCopy.current = { link: offer.link.id, rev: offer.published.rev, snapshot: offer.published.snapshot, trainer: offer.link.trainer.id }
      setOffer(null)
      appliedToast(offer, out)
    } catch { setFailed(key) }
    setBusy(false)
  }
  const onDiscard = async () => {
    setBusy(true)
    await discard(uid, offer)
    setOffer(null)
    setBusy(false)
  }
  return <UpdateCard a={offer} busy={busy} failed={failed === key} onApply={onApply} onDiscard={onDiscard} onLater={() => setLater(key)} />
}

/** The co-managed client's card: who sent it, their note, what Apply would change. */
export function UpdateCard({ a, busy, failed, onApply, onDiscard, onLater }) {
  const S = currentProfile()
  const diff = useMemo(() => {
    try { return diffPlans(heldPlan(S, a.applied?.routineIds, a.link.trainer.id), deliverable(a.published.snapshot, S?.unit || 'kg')) }
    catch { return null }
  }, [a, S])
  const nameOf = id => exerciseLabel(id, a.published.snapshot.customEx)
  return <div className="trainer-update" role="dialog" aria-label={T.updateTitle(a.link.trainer.name)} style={{
    position: 'fixed', left: 12, right: 12, bottom: 'calc(var(--sab, 0px) + 84px)', zIndex: 60, margin: '0 auto', maxWidth: 520,
    maxHeight: '60vh', overflowY: 'auto', background: 'var(--bg-el)', border: 'var(--hair) solid var(--sep)', borderRadius: 'var(--r-card)',
    boxShadow: '0 8px 30px rgba(0,0,0,.35)', padding: '12px 0',
  }}>
    <h2 className="sect-t" style={{ margin: '0 16px 4px' }}>{T.updateTitle(a.link.trainer.name)}</h2>
    {a.published.note && <p className="small" style={{ margin: '4px 16px' }}>“{a.published.note}”</p>}
    {diff && <DiffList diff={diff} nameOf={nameOf} />}
    {failed
      ? <p role="alert" className="small" style={{ margin: '8px 16px', color: 'var(--red)' }}>{T.applyFailed}</p>
      : <p className="small" style={{ margin: '8px 16px', color: 'var(--label-2)' }}>{T.updateFooter}</p>}
    <div style={{ display: 'flex', gap: 8, margin: '8px 16px 0', flexWrap: 'wrap' }}>
      {!failed && <Button variant="primary" disabled={busy} onClick={onApply}>{T.apply}</Button>}
      <Button variant="tinted" disabled={busy} onClick={onDiscard}>{T.discard}</Button>
      <Button variant="plain" disabled={busy} onClick={onLater}>{T.later}</Button>
    </div>
  </div>
}

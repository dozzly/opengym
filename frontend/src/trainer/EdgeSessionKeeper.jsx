// Keeps the app connected through the Authentik proxy in front of it (edgeSession.js): reloads by
// itself when the proxy's session ended, and during a workout offers "Reconnect" instead, so a
// running set is never interrupted. Mounted by TrainerInbox for every signed-in or signed-out
// visitor, with or without the trainer module.
import { Button, useWorkoutRunning } from './adapter.js'
import { useEdgeSessionKeeper } from './edgeSession.js'
import { EDGE_TEXT as T } from './strings.js'

export default function EdgeSessionKeeper(props) {
  const workoutRunning = useWorkoutRunning()
  const { stale, reconnect } = useEdgeSessionKeeper({ workoutRunning, ...props })
  if (!stale) return null
  return <div role="status" data-testid="edge-reconnect" style={{
    position: 'fixed', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 8px)', zIndex: 50,
    background: 'var(--card, #1c1c1e)', borderRadius: 14, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center',
    boxShadow: '0 4px 16px rgba(0,0,0,.35)'
  }}>
    <span className="small" style={{ flex: 1 }}>{T.stale}</span>
    <Button size="sm" variant="tinted" onClick={reconnect}>{T.reconnect}</Button>
  </div>
}

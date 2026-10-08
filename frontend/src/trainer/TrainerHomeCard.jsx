// The trainer card on Home: how a person reaches #/trainer from the installed app, which has no
// address bar. Mounted by Home.jsx's hook point, just above the gym check-in card, in the same style.
// Nothing unless the server reports the module on and a profile is signed in. What it says follows
// who is looking:
//   - a linked client: their trainer's name and how updates arrive;
//   - someone with trainer tools on, or allowed to switch them on: the library and clients;
//   - anyone else: "Have a code from a trainer?", which they can hide on this device.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon, tappable, useUser } from './adapter.js'
import { getCapability, getLinks } from './client.js'
import { useTrainerStatus } from './status.js'
import { useRefreshOnReturn } from './useRefreshOnReturn.js'
import { HOME_TEXT as T } from './strings.js'

const hideKey = uid => `opengym.trainer.homeHint.hidden.${uid}`
const hiddenFor = uid => { try { return localStorage.getItem(hideKey(uid)) === '1' } catch { return false } }

export default function TrainerHomeCard() {
  const status = useTrainerStatus()
  const uid = useUser()?.id || null
  const nav = useNavigate()
  const on = status?.enabled === true && !!uid
  const [view, setView] = useState(null)
  const [hidden, setHidden] = useState(() => (uid ? hiddenFor(uid) : false))
  useEffect(() => { setHidden(uid ? hiddenFor(uid) : false) }, [uid])

  const load = useCallback(async () => {
    if (!on) return
    try {
      const [cap, links] = await Promise.all([getCapability(), getLinks()])
      setView({ cap: cap || {}, client: links?.asClient || null, clients: (links?.asTrainer || []).length })
    } catch { /* offline or signed out: keep what is shown */ }
  }, [on])
  useEffect(() => { if (on) load(); else setView(null) }, [on, load])
  useRefreshOnReturn(load)

  if (!on || !view) return null
  const open = () => nav('/trainer')
  const card = (icon, label, title, extra = null) => (
    <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(open)} data-testid="trainer-home-card">
      <div className="row between">
        <div className="row" style={{ gap: 9 }}>
          <span className="lrow-i"><Icon name={icon} /></span>
          <div>
            <div className="lbl2">{label}</div>
            <div className="ttl">{title}</div>
          </div>
        </div>
        {extra || <Icon name="chevronRight" className="chev" />}
      </div>
    </div>
  )

  if (view.client) return card('person', T.yourTrainer, T.linkedSub(view.client.trainer?.name || '', view.client.mode))
  if (view.cap.enabled) return card('clipboard', T.trainer, T.trainerSub(view.clients))
  if (view.cap.allowed && view.cap.restricted) return card('clipboard', T.trainer, T.setUp)
  if (hidden) return null
  const hide = e => {
    e.stopPropagation()
    try { localStorage.setItem(hideKey(uid), '1') } catch { /* private mode: hidden until reload */ }
    setHidden(true)
  }
  return card('key', T.haveCode, T.haveCodeSub,
    <Button type="button" variant="plain" size="sm" onClick={hide} onKeyDown={e => e.stopPropagation()}>{T.hide}</Button>)
}

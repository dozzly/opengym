// "Your trainer" at #/trainer, for every signed-in user while the module is on (FIT-004).
//
// Unlinked: an invite code, the choice between co-managed and trainer-managed (one plain sentence
// each), body weight off unless switched on, and Accept. Linked: the trainer's name, the same
// choice and switch, and End link, which says the plan stays. A plan update itself arrives in the
// inbox (TrainerInbox.jsx); accepting and switching the mode ask it to look at once.
import { useCallback, useEffect, useState } from 'react'
import { Button, Row, Section, Switch, TextField } from './adapter.js'
import { getLinks, acceptInvite, updateLink, revokeLink } from './client.js'
import { requestCheck } from './delivery.js'
import { Note } from './Page.jsx'
import { LINK_TEXT as T, TEXT } from './strings.js'

const MODES = ['co-managed', 'trainer-managed']

function ModeRows({ value, onChange, disabled }) {
  return MODES.map(m => <Row key={m} title={T.modes[m].label} subtitle={T.modes[m].sentence}
    accessory={value === m ? 'check' : 'none'} onClick={disabled ? undefined : () => onChange(m)} />)
}

export default function YourTrainer() {
  const [link, setLink] = useState(undefined)   // undefined: loading; null: none; else the link
  const [code, setCode] = useState('')
  const [mode, setMode] = useState('co-managed')
  const [share, setShare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ending, setEnding] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    try { setLink((await getLinks()).asClient || null) }
    catch { setLink(undefined); setMsg({ alert: T.acceptError.other }) }
  }, [])
  useEffect(() => { load() }, [load])

  const accept = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await acceptInvite(code.trim(), mode, share)
      setLink(r.link)
      setCode('')
      setMsg({ status: T.accepted(r.link.trainer.name) })
      requestCheck()
    } catch (e) {
      setMsg({ alert: T.acceptError[e?.code] || T.acceptError[e?.data?.code] || T.acceptError.other })
    } finally { setBusy(false) }
  }
  const change = async patch => {
    setBusy(true)
    setMsg(null)
    try { setLink((await updateLink(link.id, patch)).link); requestCheck() }
    catch { setMsg({ alert: TEXT.failed }); load() }
    finally { setBusy(false) }
  }
  const end = async () => {
    setBusy(true)
    setMsg(null)
    try { await revokeLink(link.id); setLink(null); setEnding(false); setMsg({ status: T.ended }) }
    catch { setMsg({ alert: TEXT.failed }); load() }
    finally { setBusy(false) }
  }

  if (link === undefined) return <Note alert>{msg?.alert}</Note>

  if (!link) {
    return <div className="trainer-your-trainer">
      <Section title={T.yourTrainer} footer={T.unlinkedFooter}>
        <div style={{ padding: '10px 16px' }}>
          <label htmlFor="trainer-invite-code" className="small dim">{T.code}</label>
          <TextField id="trainer-invite-code" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            placeholder={T.codePlaceholder} maxLength={40} value={code} onChange={e => setCode(e.target.value)} />
        </div>
      </Section>
      <Section title={T.modeTitle}>
        <ModeRows value={mode} onChange={setMode} />
      </Section>
      <Section footer={T.shareBodyweightFooter}>
        <Row icon="scale" title={T.shareBodyweight}>
          <Switch checked={share} onChange={setShare} aria-label={T.shareBodyweight} />
        </Row>
      </Section>
      <Note alert>{msg?.alert}</Note>
      <Note>{msg?.status}</Note>
      <div style={{ margin: '0 16px 16px' }}>
        <Button variant="primary" disabled={busy || !code.trim()} onClick={accept}>{T.accept}</Button>
      </div>
    </div>
  }

  return <div className="trainer-your-trainer">
    <Section title={T.yourTrainer} footer={T.linkedFooter}>
      <Row icon="personCircle" title={T.trainer} value={link.trainer.name} />
    </Section>
    <Section title={T.modeTitle}>
      <ModeRows value={link.mode} disabled={busy} onChange={m => { if (m !== link.mode) change({ mode: m }) }} />
    </Section>
    <Section footer={T.shareBodyweightFooter}>
      <Row icon="scale" title={T.shareBodyweight}>
        <Switch checked={!!link.shareBodyweight} disabled={busy} onChange={v => change({ shareBodyweight: v })} aria-label={T.shareBodyweight} />
      </Row>
    </Section>
    <Note alert>{msg?.alert}</Note>
    <Note>{msg?.status}</Note>
    <div style={{ display: 'grid', gap: 8, margin: '0 16px 16px' }}>
      {!ending && <Button variant="danger" disabled={busy} onClick={() => setEnding(true)}>{T.endLink}</Button>}
      {ending && <>
        <p className="small" role="alert" style={{ margin: 0 }}>{T.endLinkClient(link.trainer.name)}</p>
        <Button variant="danger" disabled={busy} onClick={end}>{T.endLink}</Button>
        <Button variant="tinted" disabled={busy} onClick={() => setEnding(false)}>{T.cancel}</Button>
      </>}
    </div>
  </div>
}

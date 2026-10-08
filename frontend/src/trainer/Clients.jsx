// "Clients" at #/trainer, with trainer tools on (FIT-004): invite a client (the code is shown once,
// with a copy button and its expiry), the open invites (each revocable), and the linked clients,
// each opening #/trainer/clients/<link>.
import { useCallback, useEffect, useState } from 'react'
import { useRefreshOnReturn } from './useRefreshOnReturn.js'
import { useNavigate } from 'react-router-dom'
import { Button, Row, Section } from './adapter.js'
import { createInvite, getInvites, revokeInvite, getLinks } from './client.js'
import { Note } from './Page.jsx'
import { LINK_TEXT as T, TEXT } from './strings.js'

export default function Clients() {
  const nav = useNavigate()
  const [invites, setInvites] = useState([])
  const [links, setLinks] = useState([])
  const [fresh, setFresh] = useState(null)   // { code, invite }: shown once, gone on leaving the page
  const [copied, setCopied] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [i, l] = await Promise.all([getInvites(), getLinks()])
      setInvites(i.invites || [])
      setLinks(l.asTrainer || [])
    } catch { setMsg({ alert: TEXT.loadFailed }) }
  }, [])
  useEffect(() => { load() }, [load])
  useRefreshOnReturn(load)

  const invite = async () => {
    setBusy(true)
    setMsg(null)
    setCopied(null)
    try {
      const r = await createInvite()
      setFresh(r)
      setInvites(list => [...list, r.invite])
    } catch (e) { setMsg({ alert: (e?.data?.code || e?.code) === 'too-many-invites' ? T.tooManyInvites : TEXT.failed }) }
    finally { setBusy(false) }
  }
  const revoke = async id => {
    setBusy(true)
    setMsg(null)
    try {
      await revokeInvite(id)
      if (fresh?.invite.id === id) setFresh(null)
    } catch { setMsg({ alert: TEXT.failed }) }
    await load()
    setBusy(false)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh.code); setCopied(T.copied) }
    catch { setCopied(T.copyFailed) }
  }

  return <>
    <Section title={T.clients}>
      {links.map(l => <Row key={l.id} icon="personCircle" title={l.client.name || l.client.id}
        subtitle={`${T.modes[l.mode].label} · ${T.statusText(l.published, l.applied)}`}
        accessory="chevron" onClick={() => nav(`clients/${l.id}`)} />)}
      {!links.length && <Row icon="person" title={T.noClients} />}
      <Row icon="plusCircle" title={T.inviteClient} onClick={busy ? undefined : invite} />
    </Section>
    <Note alert>{msg?.alert}</Note>

    {fresh && <Section title={T.newCode} footer={T.codeFooter(fresh.invite.expiresAt)}>
      <Row icon="key" title={<code className="trainer-code" data-testid="invite-code" style={{ fontSize: 18, letterSpacing: 1, userSelect: 'all' }}>{fresh.code}</code>}>
        <Button size="sm" variant="tinted" icon="copy" onClick={copy}>{T.copy}</Button>
      </Row>
    </Section>}
    <Note>{copied}</Note>

    {invites.length > 0 && <Section title={T.openInvites} footer={T.openInvitesFooter}>
      {invites.map(i => <Row key={i.id} icon="envelope" title={T.invite} subtitle={T.expires(i.expiresAt)}>
        <Button size="sm" variant="plain" disabled={busy} onClick={() => revoke(i.id)} aria-label={`${T.revoke} ${T.expires(i.expiresAt)}`}>{T.revoke}</Button>
      </Row>)}
    </Section>}
  </>
}

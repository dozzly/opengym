// #/trainer/* (App.jsx, the seam's route). Nothing unless the server reports the module on: while
// it is asked, the page stays empty, and on a server without it the address goes home, exactly
// where upstream's catch-all route sends an address it does not know.
import { Navigate, useNavigate } from 'react-router-dom'
import { Row, Section } from './adapter.js'
import { useTrainerStatus } from './status.js'
import { TEXT } from './strings.js'

export default function TrainerRoot() {
  const status = useTrainerStatus()
  const nav = useNavigate()
  if (!status) return null
  if (!status.enabled) return <Navigate to="/home" replace />
  return <div className="narrow trainer-root">
    <div className="sp-nav">
      <button className="sp-back" onClick={() => nav('/home')}><span>{TEXT.back}</span></button>
    </div>
    <h1 className="sp-root-title">{TEXT.title}</h1>
    <Section footer={TEXT.nothingYet}>
      <Row icon="info" title={TEXT.version} subtitle={TEXT.on} value={'v' + status.module} />
    </Section>
  </div>
}

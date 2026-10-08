// The frame of every trainer screen: upstream's settings-page header (back button, large title),
// so the module looks like the rest of the app.
import { useNavigate } from 'react-router-dom'
import { Icon } from './adapter.js'

export default function Page({ title, back = '/home', backLabel, className = '', children }) {
  const nav = useNavigate()
  return <div className={'narrow trainer-root ' + className}>
    <div className="sp-nav">
      <button className="sp-back" onClick={() => nav(back)}><Icon name="chevronLeft" /><span>{backLabel}</span></button>
    </div>
    <h1 className="sp-root-title">{title}</h1>
    {children}
  </div>
}

/** A line the screen reader announces: errors as alerts, progress as status. */
export const Note = ({ alert, children }) => (children
  ? <p role={alert ? 'alert' : 'status'} className="small" style={{ margin: '8px 16px', color: alert ? 'var(--red)' : 'var(--label-2)' }}>{children}</p>
  : null)

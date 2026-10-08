// Reloads a screen's data when the person comes back to it: the window regains focus, or the app
// becomes visible again (a phone unlocked, the PWA brought to the front). The link screens load
// once when they open, so a trainer who kept "Clients" open while a client accepted the code saw
// "No clients yet" and a used invite still listed as open until they navigated away and back.
import { useEffect } from 'react'

export function useRefreshOnReturn(...loads) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const run = () => { for (const load of loads) load() }
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, loads) // eslint-disable-line react-hooks/exhaustive-deps
}

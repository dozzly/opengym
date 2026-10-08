// An exercise's demo video or photo: pick, prepare, upload with progress, preview.
//
// The file is prepared by upstream's own media ingest (lib/media-ingest.js, through the adapter),
// exactly as upstream's custom-exercise editor prepares one: a photo is re-encoded on a canvas
// (which leaves EXIF and GPS behind), an MP4/MOV has its metadata boxes and stray tracks zeroed, a
// poster is drawn, and both files are hashed. Both then go to the trainer's own demo store (PUT
// /api/media/trainer), never to the profile's private media. The exercise keeps only the MediaRef.
import { useEffect, useRef, useState } from 'react'
import { Button, Row, Section, loadMediaIngest, limitsFrom, useServerConfig, fmtMB, MB } from './adapter.js'
import { uploadDemo, fetchDemo } from './client.js'
import { Note } from './Page.jsx'
import { TEXT } from './strings.js'

const KIND = { video: TEXT.videoKind, image: TEXT.imageKind, gif: TEXT.gifKind }

/** The sentence for a refused file: the ingest's codes, or the server's. */
export function demoErrorText(e) {
  const T = TEXT.demoError
  const code = e?.code
  if (code === 'too-large') return T['too-large'](fmtMB(e.mb))
  if (code === 'media-too-large') return T['too-large'](fmtMB(e.data?.maxMB ?? e.maxMB ?? 0))
  if (code === 'too-long') return T['too-long'](e.sec)
  if (code === 'media-too-long') return T['too-long'](e.data?.maxSec ?? '')
  if (code === 'type' || code === 'media-type' || code === 'unreadable' || code === 'media-invalid') return T.type
  if (code === 'photo-too-big') return T['photo-too-big']
  if (code === 'media-quota') return T['media-quota']
  return T.other
}

export default function DemoField({ media, onChange, limits, onUsage }) {
  const fileRef = useRef(null)
  const config = useServerConfig()
  const [phase, setPhase] = useState({ kind: 'idle' })   // idle | preparing | uploading(pct) | error(text)
  const busy = phase.kind === 'preparing' || phase.kind === 'uploading'

  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    setPhase({ kind: 'preparing' })
    try {
      const { ingestMediaFile } = await loadMediaIngest()
      // The per-file caps are the instance's (GET /api/config), the quota the trainer's.
      const out = await ingestMediaFile(file, limitsFrom({ media: { ...(config?.media || {}), ...(limits || {}) } }))
      const total = out.blobs.reduce((n, b) => n + b.blob.size, 0) || 1
      let done = 0
      setPhase({ kind: 'uploading', pct: 0 })
      for (const b of out.blobs) {
        const res = await uploadDemo(b.blob, b.hash, b.mime, loaded => {
          setPhase({ kind: 'uploading', pct: Math.min(100, Math.round((100 * (done + loaded)) / total)) })
        })
        done += b.blob.size
        if (res?.usage) onUsage?.(res.usage)
      }
      setPhase({ kind: 'idle', warning: out.warnings?.includes('codec') ? TEXT.codecWarning : null })
      onChange(out.media)
    } catch (e) {
      setPhase({ kind: 'error', text: demoErrorText(e) })
    }
  }

  const sizeLine = media ? [KIND[media.kind], `${fmtMB(Math.max(0.1, media.size / MB), { fixed: true })} MB`].join(' · ') : null
  return <Section title={TEXT.demo} footer={TEXT.demoFooter}>
    {media && <DemoPreview media={media} />}
    <Row icon={media ? (media.kind === 'video' ? 'play' : 'image') : 'camera'} title={media ? KIND[media.kind] : TEXT.noDemo} subtitle={sizeLine}>
      <Button variant="tinted" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>{media ? TEXT.replaceDemo : TEXT.addDemo}</Button>
      {media && <Button variant="ghost" size="sm" disabled={busy} onClick={() => onChange(null)}>{TEXT.removeDemo}</Button>}
    </Row>
    <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={onFile} aria-label={TEXT.addDemo} data-testid="demo-file" />
    {phase.kind === 'preparing' && <Note>{TEXT.preparing}</Note>}
    {phase.kind === 'uploading' && <div style={{ margin: '8px 16px' }}>
      <progress max="100" value={phase.pct} aria-label={TEXT.uploading} style={{ width: '100%' }} />
      <Note>{TEXT.uploadingPct(phase.pct)}</Note>
    </div>}
    <Note>{phase.warning}</Note>
    <Note alert>{phase.kind === 'error' ? phase.text : null}</Note>
  </Section>
}

/** The trainer's own demo, fetched from the demo store into an object URL for as long as it shows. */
function DemoPreview({ media }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    let made = null
    setUrl(null)
    setFailed(false)
    fetchDemo(media.hash, media.size)
      .then(blob => {
        if (!live) return
        made = URL.createObjectURL(new Blob([blob], { type: media.mime }))
        setUrl(made)
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [media.hash, media.size, media.mime])
  if (failed) return <Note>{TEXT.previewFailed}</Note>
  if (!url) return null
  const style = { display: 'block', maxWidth: '100%', maxHeight: 320, margin: '8px auto', borderRadius: 12 }
  return media.kind === 'video'
    ? <video src={url} controls muted playsInline preload="metadata" aria-label={TEXT.demo} style={style} />
    : <img src={url} alt={TEXT.demo} style={style} />
}

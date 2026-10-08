// #/trainer: "Your trainer" (anyone signed in, FIT-004), the trainer-tools switch, then (switched
// on) the clients, the library's exercises and programmes, and the export.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Row, Section, Switch, vocabText, MB } from './adapter.js'
import { getExport } from './client.js'
import Page, { Note } from './Page.jsx'
import YourTrainer from './YourTrainer.jsx'
import Clients from './Clients.jsx'
import { TEXT } from './strings.js'

// Demo files are often a few KB (a re-encoded photo, a poster), so below 1 MB the size is in KB:
// "0 of 500 MB" read as if the uploads had gone missing.
export const sizeText = bytes => {
  if (!(bytes > 0)) return '0 MB'
  if (bytes < MB) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
  return `${Math.round((bytes / MB) * 10) / 10} MB`
}

export default function TrainerHome({ module, cap, lib, error, setEnabled }) {
  const nav = useNavigate()
  const [exportError, setExportError] = useState(null)
  const exercises = lib?.exercises || []
  const programmes = lib?.programmes || []
  const usage = lib?.media?.usage

  const download = async () => {
    setExportError(null)
    try {
      const data = await getExport()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `opengym-trainer-library-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setExportError(TEXT.exportFailed) }
  }

  const exerciseRow = e => <Row key={e.id} icon={e.media ? (e.media.kind === 'video' ? 'play' : 'image') : 'dumbbell'}
    title={e.n} subtitle={[vocabText(e.bp), e.media ? TEXT.withDemo : null].filter(Boolean).join(' · ')}
    accessory="chevron" onClick={() => nav(`exercises/${e.id}`)} />
  const programmeRow = p => <Row key={p.id} icon="list" title={p.name}
    subtitle={TEXT.routineCount(p.routines.length)} accessory="chevron" onClick={() => nav(`programmes/${p.id}`)} />

  return <Page title={TEXT.title} backLabel={TEXT.back}>
    <YourTrainer />
    <Note alert>{error}</Note>
    {cap && <Section footer={cap.allowed || cap.enabled ? `${TEXT.enableFooter} ${TEXT.offKeeps}` : TEXT.notAllowed}>
      <Row icon="clipboard" title={TEXT.enable}>
        <Switch checked={!!cap.enabled} onChange={setEnabled} disabled={!cap.allowed && !cap.enabled} aria-label={TEXT.enable} />
      </Row>
    </Section>}

    {cap?.enabled && lib && <>
      <Clients />
      <Section title={TEXT.exercises} footer={usage ? TEXT.usage(sizeText(usage.bytes), usage.quotaBytes ? sizeText(usage.quotaBytes) : null) : null}>
        {exercises.filter(e => !e.archived).map(exerciseRow)}
        <Row icon="plusCircle" title={TEXT.newExercise} onClick={() => nav('exercises/new')} />
      </Section>
      {exercises.some(e => e.archived) && <Section title={TEXT.archivedExercises}>
        {exercises.filter(e => e.archived).map(exerciseRow)}
      </Section>}

      <Section title={TEXT.programmes}>
        {programmes.filter(p => !p.archived).map(programmeRow)}
        <Row icon="plusCircle" title={TEXT.newProgramme} onClick={() => nav('programmes/new')} />
      </Section>
      {programmes.some(p => p.archived) && <Section title={TEXT.archivedProgrammes}>
        {programmes.filter(p => p.archived).map(programmeRow)}
      </Section>}

      <Section footer={TEXT.exportFooter}>
        <Row icon="download" title={TEXT.exportTitle} onClick={download} />
      </Section>
      <Note alert>{exportError}</Note>
    </>}

    <Section footer={TEXT.on}>
      <Row icon="info" title={TEXT.version} value={'v' + module} />
    </Section>
  </Page>
}

// #/trainer/* (App.jsx, the seam's route). Nothing unless the server reports the module on: while
// it is asked, the page stays empty, and on a server without it the address goes home, exactly
// where upstream's catch-all route sends an address it does not know.
//
//   #/trainer                    the switch, the library and the programmes
//   #/trainer/exercises/<id|new> one library exercise, with its demo
//   #/trainer/programmes/<id|new> one programme
import { Navigate, Route, Routes } from 'react-router-dom'
import { useTrainerStatus } from './status.js'
import { useTrainer } from './useTrainer.js'
import TrainerHome from './TrainerHome.jsx'
import ExerciseEditor from './ExerciseEditor.jsx'
import ProgrammeEditor from './ProgrammeEditor.jsx'

export default function TrainerRoot() {
  const status = useTrainerStatus()
  if (!status) return null
  if (!status.enabled) return <Navigate to="/home" replace />
  return <TrainerApp module={status.module} />
}

function TrainerApp({ module }) {
  const trainer = useTrainer()
  const ready = trainer.cap?.enabled && trainer.lib
  return <Routes>
    <Route index element={<TrainerHome module={module} {...trainer} />} />
    <Route path="exercises/:id" element={ready ? <ExerciseEditor {...trainer} /> : <Waiting cap={trainer.cap} />} />
    <Route path="programmes/:id" element={ready ? <ProgrammeEditor {...trainer} /> : <Waiting cap={trainer.cap} />} />
    <Route path="*" element={<Navigate to="/trainer" replace />} />
  </Routes>
}

// An editor's address opened before the library arrived: nothing yet, or back to the switch when
// trainer tools turn out to be off.
const Waiting = ({ cap }) => (cap && !cap.enabled ? <Navigate to="/trainer" replace /> : null)

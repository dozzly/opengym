// Always mounted (App.jsx, the seam's inbox line), outside the routed view. It will hold what
// arrives from a trainer: an assignment to apply or review, modelled on the Coach's proposal card
// (ADR 029, decision 5). Nothing unless the server reports the module on, and nothing for a guest
// or on the sign-in screen; with the module on it asks the server once, so the trainer page
// opens without a wait.
import { useTrainerStatus } from './status.js'

export default function TrainerInbox() {
  const status = useTrainerStatus()
  if (!status?.enabled) return null
  // FIT-004: the pending assignment card. Nothing is delivered yet.
  return null
}

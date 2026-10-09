// The trainer module's hook points: two in App.jsx and one on Home (dozzly/opengym, ADR 029): the /trainer/* page
// and the always-mounted inbox. Both render nothing unless the server reports the module on.
export { default as TrainerRoot } from './TrainerRoot.jsx'
export { default as TrainerInbox } from './TrainerInbox.jsx'
// The card on Home, Home.jsx's hook point: the way in to #/trainer from the installed app.
export { default as TrainerHomeCard } from './TrainerHomeCard.jsx'
// Under "Freestyle workout" on the start screen, Workout.jsx's hook point: a quick session from
// the AI Coach (FIT-008).
export { default as QuickSessionStart } from './QuickSession.jsx'

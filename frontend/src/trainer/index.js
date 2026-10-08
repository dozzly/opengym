// The trainer module's two hook points in App.jsx (dozzly/opengym, ADR 029): the /trainer/* page
// and the always-mounted inbox. Both render nothing unless the server reports the module on.
export { default as TrainerRoot } from './TrainerRoot.jsx'
export { default as TrainerInbox } from './TrainerInbox.jsx'

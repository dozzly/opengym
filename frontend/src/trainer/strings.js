// The module's own words. Kept out of upstream's translation catalogue on purpose: upstream checks
// that every literal handed to its translate function anywhere in src/ exists in all 17 locale
// packs (scripts/check-source-strings.mjs, check-locales.mjs), and the fork does not edit those
// packs. English only until the pilot needs another language; the keys are what a translation
// would hang off. (No call of that function may appear in this directory, comments included:
// the check reads the source text.) Body parts, equipment and exercise names are upstream's own
// words and go through upstream's translations (adapter.js vocabText, exerciseNameFor).
export const TEXT = {
  title: 'Trainer',
  back: 'Home',
  backToTrainer: 'Trainer',
  version: 'Trainer module',
  on: 'Switched on for this server.',

  enable: 'Enable trainer tools',
  enableFooter: 'Trainer tools give you a library of your own exercises and programmes. Turning them on shares nothing with anyone and gives nobody access to anything.',
  notAllowed: 'Trainer tools are not available to this account on this server.',
  offKeeps: 'Turned off, your library is kept as it is and cannot be changed.',

  exercises: 'Exercises',
  newExercise: 'New exercise',
  editExercise: 'Edit exercise',
  noExercises: 'No exercises yet.',
  archivedExercises: 'Archived exercises',
  programmes: 'Programmes',
  newProgramme: 'New programme',
  editProgramme: 'Edit programme',
  noProgrammes: 'No programmes yet.',
  archivedProgrammes: 'Archived programmes',
  archivedTag: 'archived',
  withDemo: 'with demo',
  routineCount: n => (n === 1 ? '1 routine' : `${n} routines`),
  exerciseCount: n => (n === 1 ? '1 exercise' : `${n} exercises`),
  usage: (used, quota) => (quota ? `Demo files use ${used} of ${quota}.` : `Demo files use ${used}.`),

  exportTitle: 'Export library',
  exportFooter: 'A file with every exercise and programme, archived ones included. Demo files are referenced, not included.',
  exportFailed: 'The export could not be made. Try again.',

  name: 'Name',
  bodyPart: 'Body part',
  equipment: 'Equipment',
  instructions: 'Instructions',
  instructionsHint: 'Setup, cues, common mistakes',
  save: 'Save',
  create: 'Create',
  archive: 'Archive',
  restore: 'Restore',
  saved: 'Saved.',
  archivedNote: 'Archived. Programmes that already use it keep it; new ones cannot add it.',

  demo: 'Demo video or photo',
  noDemo: 'No demo yet',
  addDemo: 'Add demo',
  replaceDemo: 'Replace',
  removeDemo: 'Remove',
  demoFooter: 'Only you can see your demo files. Photos are re-encoded and videos cleaned of location and camera details on this device before upload.',
  preparing: 'Preparing the file…',
  uploading: 'Uploading',
  uploadingPct: pct => `Uploading, ${pct}%`,
  codecWarning: 'This video may not play on every device. MP4 (H.264) plays everywhere.',
  previewFailed: 'The demo could not be loaded.',
  videoKind: 'Video',
  imageKind: 'Photo',
  gifKind: 'Animation',

  programmeName: 'Programme name',
  unit: 'Weights in',
  routine: 'Routine',
  routineName: 'Routine name',
  dayName: n => `Day ${n}`,
  addRoutine: 'Add routine',
  removeRoutine: 'Remove routine',
  addExercise: 'Add exercise',
  removeExercise: 'Remove',
  sets: 'Sets',
  reps: 'Reps',
  seconds: 'Seconds',
  slotInstructionsFor: name => `Instructions for ${name}`,
  slotInstructionsHint: 'Instructions your client sees during the workout: paces, grades, rest, cues',
  search: 'Search exercises',
  fromLibrary: 'Your library',
  builtIn: 'Built-in exercises',
  typeToSearch: 'Type to search the built-in exercises.',
  noMatches: 'Nothing matches.',
  close: 'Close',
  unknownExercise: id => `Unknown exercise (${id || 'no id'})`,
  unknownHint: 'Kept as it is. It cannot be sent to a client until it is replaced.',

  conflict: 'Your library changed on another device or tab. It has been reloaded; check and save again.',
  unreadable: 'Your library cannot be read on the server. Nothing has been changed. Ask the server owner to restore it from a backup.',
  off: 'Trainer tools are turned off.',
  failed: 'That did not work. Check your connection and try again.',
  loadFailed: 'Your library could not be loaded.',
  invalid: {
    n: 'Give the exercise a name of at most 80 characters, on one line.',
    bp: 'Pick a body part.',
    desc: 'Instructions can be at most 1000 characters.',
    media: 'That demo file is not usable. Pick it again.',
    name: 'Give it a name of at most 80 characters, on one line.',
    routines: 'A programme has at most 14 routines, each with a name and at most 40 exercises.',
    slot: 'Check the sets and reps: sets 1 to 20, reps 1 to 999.',
    'archived-exercise': 'An archived exercise cannot be added to a programme. Restore it first.',
    'unknown-exercise': 'That exercise is no longer in your library.',
    other: 'Something in this form is not valid.',
  },
  demoError: {
    type: 'That file type is not supported. Use a photo, a GIF, or an MP4, MOV or WebM video.',
    'too-large': mb => `That file is too big. Max ${mb} MB.`,
    'too-long': sec => `That video is too long. Max ${sec} seconds.`,
    'photo-too-big': 'That photo is too large to process on this device.',
    'media-quota': 'Your space for demo files is full. Remove or replace demos you no longer need; their space comes back after an hour.',
    other: 'The file could not be uploaded. Try again.',
  },
}

/* ---------- FIT-004: links, assignments, delivery, progress ---------- */

const date = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

export const LINK_TEXT = {
  // The client's side (#/trainer, "Your trainer")
  yourTrainer: 'Your trainer',
  haveCode: 'Have a code from a trainer?',
  haveCodeSub: 'Link with your own trainer',
  unlinkedFooter: 'A trainer gives you a code. With it, they see your name and sign-in e-mail and the workouts you do on the plan they send you, and can send you plan updates. Nothing else of yours.',
  code: 'Invite code',
  codePlaceholder: 'PT-XXXXXXXXXXXX',
  modeTitle: 'Plan updates',
  modes: {
    'co-managed': { label: 'Co-managed', sentence: 'You review each plan update and choose to apply it or not.' },
    'trainer-managed': { label: 'Trainer-managed', sentence: 'Plan updates are applied as soon as they arrive, and you can undo each one.' },
  },
  shareBodyweight: 'Share my body weight',
  shareBodyweightFooter: 'Off: your trainer does not see your body weight.',
  accept: 'Accept',
  accepted: name => `You are now linked with ${name}.`,
  trainer: 'Trainer',
  linkedFooter: 'Your trainer sees your name and sign-in e-mail, and the workouts you do on the routines they send you, with their sets and notes. Not your other routines, photos, settings or anything else.',
  endLink: 'End link',
  endLinkClient: name => `End the link with ${name}? Your current plan stays: the routines they sent become ordinary routines of yours.`,
  endLinkTrainer: name => `End the link with ${name}? You can no longer see their progress or send them updates. They keep the plan they have.`,
  cancel: 'Cancel',
  ended: 'The link has ended. Your plan stays as it is.',
  acceptError: {
    'invite-invalid': 'That is not an invite code. It looks like PT- and twelve letters and digits.',
    'invite-unknown': 'No invite has that code. Check it with your trainer.',
    'invite-used': 'That code has been used already. Ask your trainer for a new one.',
    'invite-expired': 'That code has expired. Ask your trainer for a new one.',
    'invite-revoked': 'Your trainer withdrew that code. Ask for a new one.',
    'self-link': 'That is your own invite code.',
    'has-trainer': 'You already have a trainer. End that link first.',
    'trainer-unavailable': 'That trainer is not taking clients at the moment.',
    'email-required': 'First add a password and then a sign-in e-mail in Settings → Account. Your trainer sees your name and that e-mail.',
    locked: 'Too many wrong codes. Try again in an hour.',
    other: 'That did not work. Check your connection and try again.',
  },

  // The trainer's side (#/trainer, "Clients", and #/trainer/clients/<link>)
  clients: 'Clients',
  inviteClient: 'Invite a client',
  newCode: 'New invite code',
  codeFooter: expires => `Give this code to your client. It works once, until ${date(expires)}, and is shown only now.`,
  copy: 'Copy',
  copied: 'Copied.',
  copyFailed: 'Could not copy. Select the code and copy it.',
  openInvites: 'Open invites',
  invite: 'Invite',
  expires: ms => `Expires ${date(ms)}`,
  revoke: 'Revoke',
  openInvitesFooter: 'An invite links you to whoever enters its code first.',
  tooManyInvites: 'You have ten open invites. Revoke one first.',
  inviteEmailRequired: 'First add a password and then a sign-in e-mail in Settings → Account. Your clients see your name and that e-mail.',
  noEmail: 'no sign-in e-mail',
  email: 'Sign-in e-mail',
  linkedClients: 'Linked clients',
  noClients: 'No clients yet.',
  status: 'Status',
  bodyweight: 'Body weight',
  shared: 'Shared',
  notShared: 'Not shared',
  statusText: (published, applied) => {
    if (!published) return 'Nothing sent yet'
    if (!applied || applied.rev < published.rev) return `Revision ${published.rev} sent, not applied yet`
    return applied.outcome === 'applied' ? `Revision ${applied.rev} applied` : `Revision ${applied.rev} declined`
  },
  assignProgramme: 'Assign programme',
  assignFooter: 'The programme you pick is the draft. Your client gets nothing until you publish it.',
  noProgrammes: 'Create a programme first.',
  noteToClient: 'Note to your client',
  notePlaceholder: 'What this plan is for, how to approach it',
  review: 'Review and publish',
  reviewTitle: (next, current) => (current ? `Revision ${next}, against revision ${current}` : `Revision ${next}, the first`),
  publish: 'Publish',
  published: rev => `Published revision ${rev}. Your client has been notified.`,
  draftNeeded: 'Pick a programme first.',
  unresolvedTitle: 'These exercises cannot be sent. Replace them in the programme first:',
  unresolvedSlot: (routine, id) => `${routine}: unknown exercise (${id || 'no id'})`,
  assignmentConflict: 'This client\'s plan changed in another tab. It has been reloaded; check and publish again.',
  libraryChanged: 'Your library changed since this preview. It has been reloaded; check the changes again.',
  archivedProgramme: 'That programme is archived. Restore it, or pick another.',
  progress: 'Progress',
  noProgress: 'No workouts on the assigned plan yet.',
  progressFooter: 'Workouts on the routines you sent, since the link began. Read-only.',
  ownExercise: 'An exercise of their own',
  minutes: sec => `${Math.max(1, Math.round(sec / 60))} min`,
  warmup: 'Warm-up',
  rir: n => `RIR ${n}`,
  rpe: n => `RPE ${n}`,
  notDone: 'not done',
  sides: (l, r) => `L ${l} / R ${r}`,
  bodyweightOn: (w, unit) => `Body weight ${w} ${unit}`,

  // The update card and the toast (TrainerInbox)
  updateTitle: name => `${name} sent a plan update`,
  updateFooter: 'Applying replaces the routines your trainer sent before. Your own routines, workouts, weigh-ins and settings stay as they are, and so does your week.',
  apply: 'Apply',
  discard: 'Discard',
  later: 'Later',
  applied: name => `Plan update from ${name} applied.`,
  undo: 'Undo',
  undone: 'Plan update undone.',
  applyFailed: 'This update could not be applied on this device. Discard it, and ask your trainer to send it again.',

  // The diff
  noChanges: 'No changes to routines or exercises.',
  newRoutine: name => `New routine: ${name}`,
  removedRoutine: name => `Removed routine: ${name}`,
  renamedFrom: from => `renamed from ${from}`,
  newIcon: 'new icon',
  added: names => `added ${names}`,
  removed: names => `removed ${names}`,
  changed: names => `sets, reps, weight or instructions changed for ${names}`,
  reordered: 'new order',
  newExercise: name => `New exercise: ${name}`,
  revisedExercise: (name, from, to) => (from != null && to != null ? `Updated exercise: ${name} (revision ${from} to ${to})` : `Updated exercise: ${name}`),
  unusedExercise: name => `No longer used: ${name}`,
  count: (n, one, many) => plural(n, one, many),
}

/** The sentence for a refusal of the library gate (library.js LibraryError) or of the server. */
export function invalidText(e) {
  const T = TEXT.invalid
  if (!e) return T.other
  if (T[e.code]) return T[e.code]
  const field = String(e.field || '')
  if (/^routines\.\d+\.ex\.\d+/.test(field)) return T.slot
  if (/^routines/.test(field)) return T.routines
  return T[field] || T.other
}

// The card on Home (TrainerHomeCard.jsx): the way in to #/trainer from the installed app.
export const HOME_TEXT = {
  trainer: 'Trainer',
  trainerSub: clients => (clients === 0 ? 'Library and clients' : clients === 1 ? '1 client' : `${clients} clients`),
  setUp: 'Set up your exercise library',
  yourTrainer: 'Your trainer',
  linkedSub: (name, mode) => `${name} · ${mode === 'co-managed' ? 'you review updates' : 'updates apply themselves'}`,
  haveCode: 'Have a code from a trainer?',
  haveCodeSub: 'Link with your trainer',
  hide: 'Hide',
}

// The Authentik proxy's session keeper (EdgeSessionKeeper.jsx).
export const EDGE_TEXT = {
  stale: 'Your sign-in needs a refresh to keep syncing. Your workout is kept.',
  reconnect: 'Reconnect',
}

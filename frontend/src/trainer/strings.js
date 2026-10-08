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
  usage: (usedMB, quotaMB) => (quotaMB ? `Demo files use ${usedMB} of ${quotaMB} MB.` : `Demo files use ${usedMB} MB.`),

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

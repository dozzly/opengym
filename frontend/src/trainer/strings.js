// The module's own words. Kept out of upstream's translation catalogue on purpose: upstream checks
// that every literal handed to its translate function anywhere in src/ exists in all 17 locale
// packs (scripts/check-source-strings.mjs, check-locales.mjs), and the fork does not edit those
// packs. English only until the pilot needs another language; the keys are what a translation
// would hang off. (No call of that function may appear in this directory, comments included:
// the check reads the source text.)
export const TEXT = {
  title: 'Trainer',
  back: 'Home',
  version: 'Trainer module',
  on: 'Switched on for this server.',
  nothingYet: 'Nothing to manage yet. Trainer links and assigned plans arrive in a later update.',
}

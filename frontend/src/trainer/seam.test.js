/* The seam on the app side (dozzly/README.md, "The seam"), read from the source the way upstream's
 * App.no-tabs.test.js reads App.jsx. A rebase that resolved a conflict by dropping a hook line
 * would otherwise build and pass while the module was simply never mounted. */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../App.jsx').split('\n')
const count = (lines, re) => lines.filter(l => re.test(l)).length

describe('App.jsx', () => {
  it('imports the module once, from its index', () => {
    expect(count(app, /from '\.\/trainer\//)).toBe(1)
    expect(app).toContain("import { TrainerRoot, TrainerInbox } from './trainer/index.js'")
  })

  it('routes /trainer/* first inside the signed-in <Routes>', () => {
    const at = app.findIndex(l => /^\s*<Routes>$/.test(l))
    expect(at).toBeGreaterThan(0)
    expect(app[at + 1].trim()).toBe('<Route path="/trainer/*" element={<TrainerRoot />} />')
    expect(count(app, /<TrainerRoot \/>/)).toBe(1)
  })

  it('mounts the inbox once, outside the routed view, beside the toasts', () => {
    expect(count(app, /^\s*<TrainerInbox \/>$/)).toBe(1)
    const at = app.findIndex(l => /^\s*<TrainerInbox \/>$/.test(l))
    expect(app[at - 1].trim()).toBe('<Toast />')
  })
})

describe('Home.jsx', () => {
  const home = read('../views/Home.jsx').split('\n')
  it('imports the trainer card once, from the module\'s index, right after the first import', () => {
    const at = home.findIndex(l => l === "import { TrainerHomeCard } from '../trainer/index.js'")
    expect(at).toBe(1)
    expect(home.filter(l => l.includes('TrainerHomeCard }')).length).toBe(1)
  })
  it('mounts the card once, directly above the gym check-in card', () => {
    const at = home.findIndex(l => l === '    <TrainerHomeCard />')
    expect(at).toBeGreaterThan(0)
    expect(home.filter(l => l.includes('<TrainerHomeCard />')).length).toBe(1)
    expect(home[at + 1]).toMatch(/^    \{\/\* Jump to the gym check-in cards/)
  })
})

describe('Workout.jsx', () => {
  const workout = read('../views/Workout.jsx').split('\n')
  it('imports the quick session once, from the module\'s index, right after the first import', () => {
    expect(workout.findIndex(l => l === "import { QuickSessionStart } from '../trainer/index.js'")).toBe(1)
    expect(workout.filter(l => l.includes('QuickSessionStart }')).length).toBe(1)
  })
  it('mounts it once on the start screen, directly under "Freestyle workout"', () => {
    const at = workout.findIndex(l => l === '    <QuickSessionStart />')
    expect(at).toBeGreaterThan(0)
    expect(workout.filter(l => l.includes('<QuickSessionStart />')).length).toBe(1)
    expect(workout[at - 1]).toMatch(/^    <Button icon="shuffle" onClick=\{\(\) => startFlow\(\[\]\)\}>\{t\('Freestyle workout/)
  })
})

describe('Settings.jsx', () => {
  it('offers this fork as the source of the running version (AGPL-3.0 section 13), and nothing upstream\'s', () => {
    const settings = read('../views/Settings.jsx')
    expect(settings).toContain('<a href="https://github.com/dozzly/opengym" target="_blank" rel="noopener">{t(\'Source code\')}</a>')
    expect(settings).not.toContain('href="https://github.com/DuarteSantos8/openGym"')
  })
})

describe('the module and upstream\'s locale checks', () => {
  // scripts/check-source-strings.mjs reads every non-test source file in src/ for translate calls
  // with a literal, and upstream's CI wants each in all 17 locale packs, which the fork does not
  // edit. The same pattern, over this directory.
  const CALL = /(^|[^A-Za-z0-9_$.])t\(\s*(['"])/
  it('hands no string of its own to upstream\'s translation catalogue', () => {
    const files = readdirSync(new URL('.', import.meta.url)).filter(f => /\.(js|jsx)$/.test(f) && !/\.test\.(js|jsx)$/.test(f))
    expect(files).toContain('strings.js')
    for (const f of files) expect(CALL.test(read('./' + f)), f).toBe(false)
  })
})

/* FIT-008: a quick session from the AI Coach. The request, the payload (only what the Coach's
 * consent names), the answer (upstream's validator, one routine), one repair round, and the routes
 * with their gates, against a fake provider and a fake Coach config. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './inproc.mjs';
import { cleanRequest, buildPayload, checkAnswer, runSession, promptParts, recentOf, QuickError, SESSION_PROMPT, DEFAULT_DAILY } from '../quick-session.js';
import { DATA_CATEGORIES } from '../../coach/core/payload.js';

const TODAY = '2027-01-15';
const S0 = () => ({
  unit: 'kg', lang: 'en',
  coach: { consent: { agreedAt: 1 }, profile: { goal: 'strength', daysPerWeek: 3, sessionMin: 60, equipment: ['barbell', 'dumbbell'], limitations: 'left knee' }, log: [{ who: 'user', text: 'hello' }] },
  routines: [{ id: 'r_a', name: 'Day A', ex: [{ id: '0043', sets: 3, reps: 5 }] }], week: { 1: ['r_a'] },
  customEx: [{ id: 'c_boulder', n: 'Bouldering', bp: 'cardio', custom: true }],
  workouts: [
    { id: 'w_old', d: '2027-01-01', name: 'Day A', entries: [{ id: '0043', sets: [{ w: 100, r: 5, done: true }] }] },
    { id: 'w_new', d: '2027-01-14', name: 'Day A', entries: [{ id: '0043', sets: [{ w: 100, r: 5, done: true }] }, { id: 'c_boulder', sets: [] }] }
  ],
  bw: [{ d: '2027-01-14', w: 80 }]
});
const ANSWER = (over = {}) => ({
  coach_contract: 1, opengym_plan: 1, name: 'Upper, 40 min', summary: 'Pull-focused, because yesterday was legs.', basedOn: 'your last week', week: { 1: 'r1' },
  routines: [{ id: 'r1', name: 'Upper, 40 min', emoji: 'dumbbell', why: 'Back and shoulders.', ex: [
    { id: '0294', sets: 3, mode: 'reps', reps: 10, why: 'Squeeze the shoulder blades.' },
    { id: '0405', sets: 3, mode: 'reps', reps: 12, weight: 30, why: 'Controlled.' }
  ] }],
  customEx: [], ...over
});

test('the request: minutes, a focus, how they feel, equipment the catalogue knows, a short note', () => {
  const known = new Set(['dumbbell', 'body weight']);
  assert.deepEqual(cleanRequest({ minutes: 40, focus: 'upper', equipment: ['Dumbbell', 'dumbbell', 'laser'], feeling: 'tired', note: ' left shoulder niggle ', extra: 1 }, known),
    { minutes: 40, focus: 'upper', equipment: ['dumbbell'], feeling: 'tired', note: 'left shoulder niggle' });
  assert.deepEqual(cleanRequest({ minutes: 10, focus: 'run' }, known), { minutes: 10, focus: 'run', equipment: [], feeling: 'ok' });
  for (const [raw, field] of [[{ minutes: 9, focus: 'run' }, 'minutes'], [{ minutes: 40.5, focus: 'run' }, 'minutes'], [{ minutes: 40, focus: 'yoga' }, 'focus'],
    [{ minutes: 40, focus: 'run', feeling: 'great' }, 'feeling'], [{ minutes: 40, focus: 'run', equipment: 'all' }, 'equipment'],
    [{ minutes: 40, focus: 'run', note: 'x'.repeat(301) }, 'note'], [null, 'request']]) {
    assert.throws(() => cleanRequest(raw, known), e => e instanceof QuickError && e.status === 400 && e.message.endsWith(field), JSON.stringify(raw));
  }
});

test('the payload is upstream\'s create payload cut to the consented categories, plus the request and last week by name', () => {
  const p = buildPayload(S0(), { minutes: 40, focus: 'upper', equipment: ['dumbbell'], feeling: 'ok' }, { handle: 'h_x', lang: 'en', today: TODAY });
  assert.deepEqual(Object.keys(p).sort(), ['coachProfile', 'coach_contract', 'history', 'library', 'meta', 'plan', 'recent', 'session', 'task'].sort());
  assert.equal(p.task, 'session');
  assert.equal(p.meta.profile, 'h_x', 'the Coach\'s pseudonymous handle, never a name or id');
  assert.equal(p.conversation, undefined, 'the chat is not sent');
  assert.equal(JSON.stringify(p).includes('Name of'), false);
  // Last week only, by name: the session of the 14th, not the 1st.
  assert.deepEqual(p.recent, [{ d: '2027-01-14', name: 'Day A', exercises: ['barbell full squat', 'Bouldering'] }]);
  // The library: today's equipment, the profile's own exercises, and what was trained lately.
  assert.ok(p.library.some(e => e.id === 'c_boulder' && e.custom));
  assert.ok(p.library.some(e => e.id === '0043'), 'what was trained lately stays nameable');
  assert.ok(p.library.length <= 122);
  // Every field maps onto a category the consent screen names.
  assert.deepEqual(DATA_CATEGORIES, ['plan', 'training', 'bodyweight', 'profile', 'prefs']);
  assert.equal(p.bodyweight, undefined, 'no weigh-ins: a quick session does not need them');
  // Without equipment today, the profile's own.
  const q = buildPayload(S0(), { minutes: 40, focus: 'upper', equipment: [], feeling: 'ok' }, { handle: 'h_x', lang: 'en', today: TODAY });
  assert.ok(q.library.length > 0);
  assert.deepEqual(recentOf({}, TODAY, () => null), []);
});

test('the prompt: upstream\'s common rules, then this task, then the payload', () => {
  const parts = promptParts({ a: 1 }, null, { common: 'COMMON', repair: 'R {{PREVIOUS}} {{ERRORS}}' });
  assert.equal(parts.system, 'COMMON\n\n---\n\n' + SESSION_PROMPT);
  assert.equal(parts.user, '## Payload\n\n```json\n{"a":1}\n```\n');
  assert.match(promptParts({}, { previous: 'X', errors: ['e1'] }, { common: '', repair: 'R {{PREVIOUS}} {{ERRORS}}' }).user, /R X - e1$/);
});

test('an answer passes upstream\'s plan validator and is exactly one routine of library exercises', () => {
  const payload = buildPayload(S0(), { minutes: 40, focus: 'upper', equipment: ['dumbbell'], feeling: 'ok' }, { handle: 'h', lang: 'en', today: TODAY });
  const ok = checkAnswer(ANSWER(), payload);
  assert.equal(ok.ok, true);
  assert.equal(ok.session.name, 'Upper, 40 min');
  assert.deepEqual(ok.session.routine.ex.map(e => e.id), ['0294', '0405']);
  assert.equal(ok.session.routine.ex[1].weight, undefined, 'an invented starting weight is dropped (upstream FR-20)');
  assert.equal(ok.session.week, undefined);
  const two = checkAnswer(ANSWER({ routines: [ANSWER().routines[0], { ...ANSWER().routines[0], id: 'r2' }] }), payload);
  assert.equal(two.ok, false);
  assert.match(two.errors[0], /exactly one routine/);
  const invented = checkAnswer(ANSWER({ routines: [{ ...ANSWER().routines[0], ex: [{ id: '9999x', sets: 3 }] }] }), payload);
  assert.equal(invented.ok, false);
  assert.match(invented.errors.join(' '), /not in the exercise library/);
  const custom = checkAnswer(ANSWER({ customEx: [{ id: 'cx1', n: 'Thing' }] }), payload);
  assert.equal(custom.ok, false);
  // Their own exercise, from the library slice, is fine.
  assert.equal(checkAnswer(ANSWER({ routines: [{ id: 'r1', name: 'Wall', ex: [{ id: 'c_boulder', sets: 1, mode: 'time', sec: 3600, why: 'Warm-up, then 4 × 4 on V2.' }] }] }), payload).ok, true);
});

const adapterAnswering = (...texts) => {
  const calls = [];
  return { calls, spawns: false, async invoke(opts) { calls.push(opts); const t = texts.shift(); return typeof t === 'object' ? t : { code: 0, text: t }; } };
};

test('one repair round, as upstream\'s pipeline; then a classified failure', async () => {
  const payload = buildPayload(S0(), { minutes: 40, focus: 'upper', equipment: ['dumbbell'], feeling: 'ok' }, { handle: 'h', lang: 'en', today: TODAY });
  const fixed = adapterAnswering(JSON.stringify(ANSWER({ routines: [] })), JSON.stringify(ANSWER()));
  const r = await runSession({ adapter: fixed, cfg: {}, payload, model: 'm' });
  assert.equal(r.ok, true);
  assert.equal(fixed.calls.length, 2);
  assert.match(fixed.calls[1].prompt, /REPAIR REQUEST/);
  assert.ok(fixed.calls[0].schema, 'structured output, as the Coach asks for a plan');
  const twice = adapterAnswering('not json', 'still not');
  assert.deepEqual(await runSession({ adapter: twice, cfg: {}, payload }), { ok: false, errorClass: 'unusable' });
  assert.deepEqual(await runSession({ adapter: adapterAnswering({ code: 1, stderr: '401 bad key' }), cfg: {}, payload }), { ok: false, errorClass: 'auth' });
  assert.deepEqual(await runSession({ adapter: adapterAnswering({ code: 1, timedOut: true }), cfg: {}, payload }), { ok: false, errorClass: 'timeout' });
});

/* ---------------------------------------------------------------- routes */

function fakeCoach({ enabled = true, spawns = false, perProfileDaily = 0, instanceDaily = 0, answers = [JSON.stringify(ANSWER())], busy = false } = {}) {
  const store = { daily: null, caps: { perProfileDaily, instanceDaily }, provider: 'compatible' };
  const log = [];
  const adapter = adapterAnswering(...answers);
  adapter.spawns = spawns;
  return {
    log, adapter, store,
    deps: {
      config: {
        isEnabled: () => enabled, isConnected: () => enabled, load: () => store, save: patch => Object.assign(store, patch),
        modelFor: () => 'dozzly/gym-coach-v1', jobEnv: () => ({ OPENAI_API_KEY: 'k' }), credentialFor: () => ({ ok: true }),
        bindInstanceCredential() {}, logJob: e => log.push(e)
      },
      jobs: { status: () => ({ job: busy ? { id: 'x' } : null }) },
      adapterOf: () => adapter,
      handleOf: () => 'h_anna',
      fetchOf: () => fetch
    }
  };
}
const settle = () => new Promise(r => setImmediate(r));

test('routes: available, a request, the answer, and dismiss; the Coach\'s log gets the outcome and no content', async t => {
  const coach = fakeCoach();
  const h = harness(t, { quickDeps: coach.deps });
  h.writeState('u_anna', S0());
  let r = await h.call('GET', '/api/trainer/quick-session', { uid: 'u_anna' });
  assert.deepEqual(r.body, { available: true, consent: true, job: null });
  r = await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body: { minutes: 40, focus: 'upper', equipment: ['dumbbell'], lang: 'en' } });
  assert.equal(r.status, 202);
  assert.equal(r.body.job.state, 'running');
  await settle(); await settle();
  r = await h.call('GET', '/api/trainer/quick-session', { uid: 'u_anna' });
  assert.equal(r.body.job.state, 'ready');
  assert.equal(r.body.job.session.routine.ex.length, 2);
  assert.equal(r.body.job.request, undefined);
  // What left: the payload, with the handle and no name.
  const sent = coach.adapter.calls[0].prompt;
  assert.match(sent, /"profile":"h_anna"/);
  assert.equal(sent.includes('Name of'), false);
  assert.deepEqual(coach.log.map(e => [e.kind, e.outcome, e.detail]), [['session', 'ready', null]]);
  assert.deepEqual(h.audits.map(a => a.ev), ['trainer.quick.request']);
  // Someone else sees nothing of it.
  assert.equal((await h.call('GET', '/api/trainer/quick-session', { uid: 'u_bea' })).body.job, null);
  await h.call('DELETE', '/api/trainer/quick-session', { uid: 'u_anna' });
  assert.equal((await h.call('GET', '/api/trainer/quick-session', { uid: 'u_anna' })).body.job, null);
});

test('routes: refused without the Coach, a provider that spawns, consent, while busy, past the caps, or signed out', async t => {
  const body = { minutes: 30, focus: 'run' };
  const off = harness(t, { quickDeps: fakeCoach({ enabled: false }).deps });
  off.writeState('u_anna', S0());
  assert.deepEqual((await off.call('GET', '/api/trainer/quick-session', { uid: 'u_anna' })).body, { available: false, reason: 'off', consent: true, job: null });
  assert.equal((await off.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body })).status, 503);
  const cli = harness(t, { quickDeps: fakeCoach({ spawns: true }).deps });
  assert.equal((await cli.call('GET', '/api/trainer/quick-session', { uid: 'u_anna' })).body.reason, 'provider');

  const coach = fakeCoach({ perProfileDaily: 2, answers: Array(5).fill(JSON.stringify(ANSWER())) });
  const h = harness(t, { quickDeps: coach.deps });
  const noConsent = S0(); delete noConsent.coach.consent;
  h.writeState('u_bea', noConsent);
  let r = await h.call('POST', '/api/trainer/quick-session', { uid: 'u_bea', body });
  assert.deepEqual([r.status, r.body.code], [403, 'consent']);
  assert.equal(coach.adapter.calls.length, 0);
  h.writeState('u_anna', S0());
  // The provider holds its answer until released, so the second request finds the first running.
  let release;
  const gate = new Promise(res => { release = res; });
  const answer = coach.adapter.invoke;
  coach.adapter.invoke = async o => { await gate; return answer(o); };
  assert.equal((await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body })).status, 202);
  r = await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body });
  assert.deepEqual([r.status, r.body.code], [409, 'busy'], 'one at a time');
  release();
  await settle(); await settle();
  assert.equal((await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body })).status, 202);
  await settle(); await settle();
  r = await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body });
  assert.deepEqual([r.status, r.body.code], [429, 'cap'], 'the Coach\'s per-profile limit, counted here');
  assert.equal(coach.store.daily.count, 2, 'and the Coach\'s instance count moved with them');
  // The next day, the count starts again.
  h.clock.t += 86400000;
  assert.equal((await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body })).status, 202);

  const busy = harness(t, { quickDeps: fakeCoach({ busy: true }).deps });
  busy.writeState('u_anna', S0());
  assert.equal((await busy.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body })).body.code, 'busy', 'a Coach job of their own is running');
  assert.equal((await h.call('POST', '/api/trainer/quick-session', { body })).status, 401);
  assert.equal((await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body: { minutes: 5, focus: 'run' } })).status, 400);
  assert.equal(DEFAULT_DAILY, 10);
});

test('routes: consent withdrawn while the provider thinks drops the answer', async t => {
  const coach = fakeCoach();
  const h = harness(t, { quickDeps: coach.deps });
  h.writeState('u_anna', S0());
  coach.adapter.invoke = async () => { const S = S0(); delete S.coach.consent; h.writeState('u_anna', S); return { code: 0, text: JSON.stringify(ANSWER()) }; };
  await h.call('POST', '/api/trainer/quick-session', { uid: 'u_anna', body: { minutes: 30, focus: 'upper' } });
  await settle(); await settle();
  const job = (await h.call('GET', '/api/trainer/quick-session', { uid: 'u_anna' })).body.job;
  assert.deepEqual([job.state, job.errorClass, job.session], ['failed', 'consent', undefined]);
});

test('the Coach internals a quick session is built from are still what it expects (a rebase that moved one fails here)', async () => {
  const config = await import('../../coach/config.js');
  for (const f of ['load', 'save', 'isEnabled', 'isConnected', 'modelFor', 'jobEnv', 'credentialFor', 'bindInstanceCredential', 'logJob']) assert.equal(typeof config[f], 'function', `config.${f}`);
  const jobs = await import('../../coach/jobs.js');
  assert.equal(typeof jobs.status, 'function');
  const { adapterFor } = await import('../../coach/adapters/index.js');
  assert.equal(adapterFor('compatible')?.spawns, false, 'the OpenAI-compatible endpoint (the one dozzly runs) starts nothing in the container');
  const payload = await import('../../coach/core/payload.js');
  for (const f of ['build', 'librarySlice', 'libraryName', 'langTag']) assert.equal(typeof payload[f], 'function', `payload.${f}`);
  assert.ok(Array.isArray(payload.LIBRARY) && payload.LIBRARY.length > 1000);
  assert.ok(payload.MAX_PAYLOAD_CHARS > 100000);
  const { PROMPTS } = await import('../../coach/core/prompts.js');
  assert.match(PROMPTS.common, /Every exercise you name must come from the `library` array/);
  assert.match(PROMPTS.repair, /\{\{PREVIOUS\}\}[\s\S]*\{\{ERRORS\}\}/);
  const { CREATE_SCHEMA } = await import('../../coach/core/schemas.js');
  assert.deepEqual(CREATE_SCHEMA.required, ['coach_contract', 'week', 'routines']);
  const { extractJSON, contractOK } = await import('../../coach/core/parse.js');
  assert.deepEqual(extractJSON('{"coach_contract":1}').value, { coach_contract: 1 });
  assert.equal(contractOK({ coach_contract: 1 }), true);
  // A create payload carries what the quick payload keeps, under these names.
  const p = payload.build({ unit: 'kg', coach: {}, routines: [], workouts: [] }, { handle: 'h', kind: 'create' });
  for (const k of ['coach_contract', 'meta', 'coachProfile', 'plan', 'library']) assert.ok(k in p, k);
});

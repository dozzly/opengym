# dozzly/opengym

This is [openGym](https://github.com/DuarteSantos8/openGym) (AGPL-3.0-or-later) with one addition:
a **trainer module**. It lets a trainer manage the plan of a client who has agreed to it. The fork
exists to run that pilot sooner than upstream's own trainer milestone (#119, v1.4.3), on the
self-hosted instance at `gym.dozzly.network`.

The design is ADR 029, "openGym trainer features as a thin-seam fork module", in
`dozzly/dozzly-cluster` (`docs/decisions/029-opengym-trainer-delivery.md`, roadmap task FIT-006):

- All trainer code lives in directories upstream never touches.
- Upstream files get a handful of one-line hook points (the seam).
- A scheduled workflow rebases that patch onto each upstream release, tests it, and builds the
  images.

Everything else in this repository is upstream's, unchanged.

## Contents

- [Branches and layout](#branches-and-layout)
- [The seam](#the-seam)
- [Switching the module on and off](#switching-the-module-on-and-off)
- [The trainer library (FIT-003)](#the-trainer-library-fit-003)
- [Links, delivery and progress (FIT-004)](#links-delivery-and-progress-fit-004)
- [Data contract](#data-contract)
- [How the sync works](#how-the-sync-works)
- [When the sync opens an issue](#when-the-sync-opens-an-issue)
- [Rolling back](#rolling-back)
- [Licence and source offer](#licence-and-source-offer)
- [One-time setup for the owner](#one-time-setup-for-the-owner)
- [Working on the module](#working-on-the-module)

## Branches and layout

**Branches and tags:**

| Ref | What it is |
|---|---|
| `main` | Upstream `main`, fast-forwarded by the sync. Never committed to here. |
| `dozzly/trainer` | The deployable branch and the **default branch**. It holds the upstream release named in `dozzly/UPSTREAM`, then one seam commit, then the module's commits. It is rebased, so its history is rewritten on every upstream release. |
| `dozzly/build/<version>-dozzly.<n>` | Tags. Each names the exact commit an image of that tag was built from. |

**Module files:**

| Path | What it is |
|---|---|
| `api/trainer/` | Server half. `routes.js` is a route factory like `api/coach/routes.js`; `link-routes.js` holds the FIT-004 routes it adds. `library.js` validates library data; `store.js` and `capability.js` are its files; `demo-media.js` runs upstream's media store for demo files. FIT-004: `links.js` (invites, links, the code limiter), `assignments.js` (drafts, published revisions, acknowledgements), `snapshot.js` (the server's port of the snapshot, with `catalog-og1.js`, og1's exercise ids), `progress.js` (the read-only progress view) and `cleanup.js` (data of deleted profiles). Tests are in `test/`; `media.contract.test.js` and `seam.test.js` pin the upstream internals the server half uses. |
| `frontend/src/trainer/` | App half. `adapter.js` is the only file here that reaches into upstream internals; `contract.test.js` pins those internals. `library.js` mirrors the server's validation and resolves built-in exercises. `snapshot.js` is the durable-snapshot core; `snapshot-parity.test.js` pins the server's port to it. FIT-004: `delivery.js` (apply, discard, undo, demo copies), `diff.js` and `DiffList.jsx`. The screens are `TrainerRoot.jsx`, `TrainerHome.jsx`, `YourTrainer.jsx`, `Clients.jsx`, `ClientDetail.jsx`, `ExerciseEditor.jsx`, `ProgrammeEditor.jsx` and `DemoField.jsx`, plus `TrainerInbox.jsx`. `acceptance.test.jsx` runs FIT-004's acceptance against the real server. |
| `dozzly/` | This file. `UPSTREAM` is the release the branch is based on. `test.sh` runs every suite. `seam-replay.sh` is the seam durability check. |
| `.github/workflows/dozzly-sync.yaml` | The sync, test, build and deploy-proposal workflow. |

## The seam

These are the only edits to upstream-owned files, all in one commit
(`dozzly: seam - hook points for the trainer module`). The budget is about 15 changed lines
(ADR 029, decision 3). This seam is 10: 8 added and 2 changed (`git diff --stat`: 6 files, +10 −2).

| File | Lines | What and where |
|---|---|---|
| `api/server.js` | +2 | `import { trainerRoutes } from './trainer/routes.js';` on the line after the `coachRoutes` import. `...trainerRoutes({ … }),` on the line before `...coachRoutes({ json, readBody, readSession, requireAdmin }),`. |
| `api/Dockerfile` | +1 | `COPY trainer ./trainer` after `COPY coach ./coach`. |
| `frontend/src/App.jsx` | +3 | The import after the `react-router-dom` import. `<Route path="/trainer/*" …/>` directly after `<Routes>`. `<TrainerInbox />` between `<Toast />` and `<TimerFlash />`. |
| `frontend/src/views/Home.jsx` | +2 | `import { TrainerHomeCard } from '../trainer/index.js'` after the first import (`useState` from `react`). `<TrainerHomeCard />` on the line before the gym check-in card's comment (`{/* Jump to the gym check-in cards`), so the card sits just above "At the gym". It is the way in to `#/trainer` from the installed app, which has no address bar; it renders nothing while the module is off. |
| `frontend/src/views/Settings.jsx` | ±1 | The "Source code" link points at this repository ([licence](#licence-and-source-offer)). |
| `frontend/src/views/Settings.reset.test.jsx` | ±1 | Upstream's test that pins that link's address (since v1.3.9) expects this repository, so upstream's own suite stays green. |

**The helpers object.** The route spread hands the module one object holding everything it is
expected to need: `json`, `readBody`, `readSession`, `requireAdmin`, `audit`, `readStateStrict`,
`UNREADABLE`, `atomicWrite`, `dataDir`, `sendPush`, `HttpError`, `media` (the media store, or
`null` with uploads off), `sendMediaFile` and `users()`. Passing everything now means the line
rarely has to change. `api/trainer/test/seam.test.js` checks that every one of these is still
declared in `server.js`.

**No Settings entry, on purpose; a Home card instead.** ADR 029 allows one Settings row. Any wording would be a new
`t()` string, and upstream's CI requires every such string in all 17 locale packs. Rendering a
row from the module needs an import plus a line in a file upstream is redesigning right now
(`views/settings-pages.js`, v1.3.11). The module's own pages are at `#/trainer`, reached from the card on Home, and its inbox is mounted
app-wide. The card's words are the module's own (English), so no locale pack changes.

**Durability.** `dozzly/seam-replay.sh v1.3.2 upstream/main` applies this exact seam at v1.3.2 (the
first release with the gym check-in card Home's anchor needs) and rebases it across every later
release. The Home lines alone were replayed v1.3.2 → main on 2026-10-08 (25 upstream commits to
`Home.jsx`): clean. The earlier run of the rest of the seam, from v1.2.15 across every later
release, gave this on 2026-10-08:

| Release | Upstream commits | Result |
|---|---|---|
| v1.2.16 to v1.3.8 (10 releases) | 1 to 100 each | clean |
| v1.3.9 | 421 | conflict in `api/server.js` (upstream added a trailing comma to the `coachRoutes` line) and in `Settings.jsx` (the source link moved from GitLab to GitHub) |
| v1.3.10 | 330 | conflict in `Settings.jsx` and its test (the link text became `t('Source code')`) |
| main | 1 | clean |

The `App.jsx`, `Dockerfile` and import anchors never conflicted. Each conflict is upstream editing
the anchor line itself, or the line next to it, and is resolved by re-applying the one line.
`api/trainer/test/seam.test.js` and `frontend/src/trainer/seam.test.js` fail if a resolution ever
drops a hook line.

## Switching the module on and off

The module is off unless the api container has `TRAINER=1` (or `true`, `yes`, `on`).

**Off:**
- `api/trainer/routes.js` registers no routes, so every `/api/trainer/*` path gets the server's
  plain 404, the same answer an upstream build gives.
- The app asks `GET /api/trainer/status` once per signed-in profile. On a 404 it shows nothing:
  `#/trainer` goes home, as upstream's catch-all route would send it.
- Guests never ask.

**On:** `GET /api/trainer/status` answers `401` when signed out, and
`{ "enabled": true, "module": "<version>" }` when signed in. The trainer library's routes are
added too ([below](#the-trainer-library-fit-003)), and the routes for links, assignments and
progress ([FIT-004](#links-delivery-and-progress-fit-004)). Turning the module on does not, by
itself, let anyone do anything. Each user who wants trainer tools turns them on for themselves at
`#/trainer`, and a trainer reaches a client only through a link that client accepted.

**Storage.** Everything the module stores is under `DATA_DIR/trainer/`. Nothing is created there
until someone writes. The module never writes `state-<uid>.json`, `db.json` or anything under
`DATA_DIR/uploads/` (ADR 029, decision 4).

## The trainer library (FIT-003)

A trainer keeps reusable exercises and programmes in a library of their own, with a demo video or
photo per exercise. This section covers the trainer's own library; links, delivery to clients and
progress are [FIT-004](#links-delivery-and-progress-fit-004).

### Environment

| Variable | Default | What it does |
|---|---|---|
| `TRAINER` | unset (off) | `1`, `true`, `yes` or `on` registers the module's routes. Off, every route below is the server's plain 404. |
| `TRAINER_ALLOW` | unset (anyone) | A comma-separated list of user ids who may turn trainer tools on. Unset or empty means any signed-in user may. Someone removed from the list counts as off; their record is not touched. |
| `TRAINER_MEDIA_QUOTA_MB` | `500` | The demo-file quota per trainer, in MiB. Fractions are allowed; `0` means no cap; an unparseable value falls back to 500. |
| `MEDIA_*` | upstream's | The per-file caps, the sweep's grace period and the free-disk floor are upstream's settings (`docs/SELF_HOSTING.md`). `MEDIA_UPLOADS=0` also removes the two demo routes. `MEDIA_QUOTA_MB` does not apply to demo files. |

### Routes

The dispatcher matches exact paths only, so ids go in the body or the query string. Every write
carries `baseRev` (and `baseWid`, when known), with `PUT /api/data`'s semantics. A stale write
gets `409 { error: 'conflict', rev, wid, library }`, which includes the current library.

| Route | What it does |
|---|---|
| `GET /api/trainer/capability` | `{ enabled, allowed }` for the signed-in user. |
| `POST /api/trainer/capability` | `{ enabled: true or false }`: turns trainer tools on or off for oneself. `403` outside `TRAINER_ALLOW`. |
| `GET /api/trainer/library` | The caller's library, `{ v, rev, wid, exercises, programmes, owner, media: { usage, limits } }`. |
| `POST /api/trainer/library/exercises` | `{ baseRev, exercise }`. Creates an exercise; the server assigns the id. |
| `PUT /api/trainer/library/exercises` | `{ baseRev, id, exercise, archived? }`. Edits an exercise. `rev` goes up only when the content changes. `archived: false` restores an archived exercise. |
| `DELETE /api/trainer/library/exercises` | `?id=&baseRev=` (or the same fields in the body). Archives the exercise; nothing is deleted. |
| `POST`, `PUT`, `DELETE /api/trainer/library/programmes` | The same for programmes, with `programme` in place of `exercise`. |
| `GET /api/trainer/library/export` | Portable JSON: `{ opengym_trainer_library: 1, module, exported, exercises, programmes }`. It includes archived items and media refs, but no file bytes and no account id. |
| `PUT /api/media/trainer?hash=<sha256>` | Uploads one demo file as raw bytes, with the MediaRef's type as `Content-Type`. |
| `GET /api/media/trainer?hash=<sha256>` | Returns one demo file, with upstream's hardened headers (`sendMediaFile`). |

**Who can call these routes:**
- Every library and upload route needs a session (`401` without one) and trainer tools turned on
  (`403 trainer-off` otherwise). Turned off, the library stays on disk, and reads and writes are
  refused.
- No library route reads another user's data.
- Reading a demo file is decided by one function, `canReadDemo(viewer, trainer, hash)` in
  `api/trainer/demo-media.js`. It allows the owning trainer, with tools on, and (FIT-004) the
  client of an active link with that trainer, for a hash a published snapshot of that link names.
  Anyone else gets the same `404 media-missing` that a file that does not exist gets.

The two media routes live under `/api/media/` because that is the only nginx location that
passes large bodies through unbuffered (`web/nginx.conf.template`). Everything else under `/api/`
is capped at 5 MB.

### What is stored

| Path | Contents |
|---|---|
| `DATA_DIR/trainer/capabilities.json` | `{ v: 1, users: { <uid>: { enabled, at } } }`: one switch per user, and nothing else. No grants, no links. |
| `DATA_DIR/trainer/library/<uid>.json` | `{ v: 1, rev, wid, exercises: [], programmes: [] }`. |
| `DATA_DIR/trainer/media/<uid>/<sha256>.<ext>` | Demo files, plus `.gc.json` (sweep marks) and `.tmp/` (uploads in progress). |

**Library exercise:**
- A stable id, `tx_<16 hex>`.
- `rev`, which goes up with every content change.
- `archived`, `createdAt` and `updatedAt`.
- Upstream's custom-exercise content, as far as it applies: `n`, `bp`, `eq`, `desc`
  (instructions), `primaries`, `secondaries`, `url`, and `media` (upstream's MediaRef, validated
  the way the app's `normalizeMediaRef` validates it).

**Programme:**
- `tp_<16 hex>`, `rev`, `name`, `unit` (`kg` or `lb`).
- Upstream-shaped `routines`, each with a stable `tr_<16 hex>` id.
- A `week`, plus `archived` and the two timestamps.

**Programme slots.** A slot names either:
- a library exercise, as `{ id: 'tx_…', sets, reps, … }`. It must exist and not be archived
  when it is added. An archived exercise stays usable in programmes that already had it.
- a built-in exercise, as `{ id: '0043', catalog: 'og1', … }`.

**Built-in exercise ids.** Upstream's v1.4.0 replaces its exercise catalogue, and the ids change.
Upstream migrates its own data, but not `DATA_DIR/trainer/`. So:
- Every built-in reference records the catalogue it came from. `og1` is openGym 1.3.x's
  catalogue: 1,324 exercises with four-digit ids.
- All such references go through `builtinRef()` (server and app) and `resolveBuiltin()` (app).
  A later id mapping belongs there.
- The app trusts an `og1` id only while its own catalogue still fingerprints as `og1`. Otherwise
  the slot shows as "Unknown exercise", is kept in the programme, and is left out of a snapshot,
  which lists it in `unresolved`.
- `contract.test.js` fails the build when upstream's catalogue stops being `og1`.

**Bounds.** Every string, list and number is bounded, and unknown fields are dropped. The limits
are 500 exercises and 100 programmes per trainer, 14 routines per programme, 40 slots per
routine, 80-character names and 1,000-character instructions. A value out of range is refused,
not clamped.

**Demo files** are a separate security domain from private media. The module runs its own
instance of upstream's `createMediaStore` on `DATA_DIR/trainer/media/`, with upstream's modes
(0700 directories, 0600 files), checks and caps, and a quota per trainer. Its view of a trainer's
"state" is that trainer's library, archived exercises included, plus every demo a retained
published snapshot names (FIT-004). As a result:
- Upstream's sweep (hourly, and five minutes after boot) keeps every file the library or a
  published revision refers to.
- A file nothing refers to is removed after upstream's grace period (`MEDIA_GC_GRACE_DAYS`, 14
  days). Under quota pressure that becomes an hour, as in upstream.
- A library or assignment that is missing or unreadable keeps every file.
- A folder whose user is not in `db.json` is left alone.

**Audit.** `audit.log` gets these events:
- `trainer.capability`
- `trainer.exercise.create`, `.update`, `.archive`, `.restore`, `.denied`, `.refused`
- `trainer.programme.*`, with the same suffixes
- `trainer.media.upload`, `.refused`, `.denied`

Each event records the user id, item ids, revisions, counts and a hash prefix. It never records
names, instructions, file contents or the account's display name.

**Safety:**
- A missing library reads as empty.
- A library or capabilities file that cannot be parsed is never replaced. Reads and writes of the
  library answer `503 unreadable`, and nobody counts as turned on.
- Nothing is ever deleted because something is missing.

### Backup and restore

Everything is under `DATA_DIR/trainer/`, inside the `opengym-data` volume, so the volume backup
already covers it. Restoring the volume restores the module's data along with upstream's, and each
trainer's library keeps its ids and revisions. After a restore:
- A device still showing a newer revision gets a 409 on its next write, and the reloaded library
  replaces what it shows.
- Write ids are checked too, so a revision number reused after the restore is still caught.

To remove the module's data, delete `DATA_DIR/trainer/` after taking a backup.

When an admin deletes a profile, upstream removes that profile's state and uploads, but not the
profile's trainer data. Since FIT-004 the module's hourly clean-up removes it
([below](#clean-up-of-deleted-profiles)).

### The durable snapshot

`frontend/src/trainer/snapshot.js` holds the core that FIT-004 delivers. The server publishes
with its own port, `api/trainer/snapshot.js`; `snapshot-parity.test.js` runs both over the same
libraries and wants byte-identical JSON.
- `snapshotProgramme(library, programmeId)` deep-copies one programme:
  - Its routines, in upstream's shape, each with `assigned: { by, assignmentId, rev }`
    (`assignmentId` is the link id).
  - A built-in slot keeps its catalogue (`{ id: '0043', catalog: 'og1', … }`): a snapshot may be
    applied long after it was taken, by an app whose catalogue has moved on.
  - Each library exercise they use, as a full custom exercise under its `tx_` id: `custom: true`,
    the MediaRef, and `src: { trainer, exRev }`.
  - `unresolved` lists slots that cannot be delivered: a library exercise that is gone, or a
    built-in id its catalogue does not hold (the server checks against og1's id list,
    `catalog-og1.js`; the app against its catalogue). Publishing refuses any.
  - Later library edits or archiving do not change a snapshot that was already taken.
- `deliverable(snapshot, unit)` is what applying would write: each built-in slot resolved in this
  app's catalogue with `resolveBuiltin()` (or left out and counted in `dropped`, never read as
  another exercise), then upstream's `parsePlan`.
- `applySnapshot(state, snapshot, { previousRoutineIds })`:
  - Replaces only the routines recorded for the previous revision, in place, keeping their ids.
    A routine this same trainer delivered before (the snapshot's id, the trainer's marker; a copy
    gets a new id) is replaced in place too: what a new link to the same trainer, or an undone
    revision, leaves behind.
  - Removes routines dropped from the new revision, using upstream's `deleteRoutine`.
  - Adds or updates the custom exercises and never removes one.
  - Converts units through `parsePlan`.
  - Touches nothing else.
  - If a routine or exercise id in the snapshot already belongs to something the module did not
    deliver, it refuses before changing anything.

## Links, delivery and progress (FIT-004)

A trainer reaches a client only through a link the client accepted. The link carries exactly two
scopes, `read_progress` and `write_assigned_plan`, and the client's choice of mode. The trainer
publishes revisions of a plan; the client's own app applies them and syncs them as it syncs
everything else. The server never writes a client's `state-<uid>.json`, `db.json` or anything
under `DATA_DIR/uploads/` (ADR 029, decision 5).

### Consent

- **Invites.** A trainer with tools on creates a one-time code: `PT-` and 12 base32 characters
  (60 bits) from crypto. It is shown once. The server keeps only its SHA-256 and an expiry seven
  days out. A trainer has at most ten open invites, and can revoke any of them.
- **Accepting.** Any signed-in user can accept a code, choosing:
  - **co-managed**: each plan update is offered for the client to apply or discard;
  - **trainer-managed**: updates are applied as they arrive, each with an Undo;
  - whether to share body weight (off by default).

  Refused: the trainer's own code (`self-link`), a code that is used, revoked, expired or unknown,
  a trainer who switched tools off since (`trainer-unavailable`), and a client who already has a
  trainer (`409 has-trainer`: one trainer per client in the MVP). The invite is consumed in the
  same synchronous read-check-write that creates the link, so a code links once. Wrong codes are
  counted per user, ten an hour, then `429` with `Retry-After`, whatever the code.
- **The link.** Either side ends it at once. The client can switch the mode and the body-weight
  switch. An ended link stays on record (ids and times, `revokedBy`) and grants nothing; its
  assignment file is removed. The client keeps the plan it applied, as ordinary routines.

### Routes

All under the same `TRAINER` switch: off, each is the plain 404. The dispatcher matches exact
paths, so ids go in the body or the query string.

| Route | Who | What it does |
|---|---|---|
| `POST /api/trainer/invites` | trainer | `{ code, invite: { id, createdAt, expiresAt } }`. `409 too-many-invites` past ten. |
| `GET /api/trainer/invites` | trainer | The open invites, without codes. |
| `DELETE /api/trainer/invites` | trainer | `?id=` (or `{ id }`): revokes one. |
| `POST /api/trainer/links/accept` | signed in | `{ code, mode, shareBodyweight }` → `201 { link }`. |
| `GET /api/trainer/links` | signed in | `{ asTrainer: [{ id, client: { id, name }, mode, shareBodyweight, published, applied }], asClient: { id, trainer: { id, name }, mode, shareBodyweight } \| null }`. |
| `POST /api/trainer/links/update` | client | `{ id, mode?, shareBodyweight? }`. |
| `POST /api/trainer/links/revoke` | either side | `{ id }`. |
| `GET /api/trainer/assignments?link=` | trainer | `{ link, rev, wid, draft, published, applied, programme, preview, libraryRev }`. `preview` is the server-built snapshot the draft would publish. |
| `PUT /api/trainer/assignments/draft` | trainer | `{ link, programmeId, note, baseRev }`: a non-archived programme of the trainer's library (or `null` to clear). |
| `POST /api/trainer/assignments/publish` | trainer | `{ link, baseRev, libraryRev? }`: builds the snapshot from the library and publishes it as the next revision. `400 unresolved` lists slots it cannot deliver; `409` when `baseRev` is stale, or `library-changed` when the library moved since the preview. Sends a push to the client. |
| `GET /api/trainer/assignment` | client | `{ linked: false }`, or `{ linked: true, link, published, applied }` with the latest revision. |
| `POST /api/trainer/assignment/ack` | client | `{ link, rev, outcome: 'applied' \| 'discarded', routineIds }`. |
| `GET /api/trainer/progress?link=` | trainer | The read-only progress view ([below](#progress)). |

**Who can call these routes:**
- Trainer routes need a session and trainer tools on (`403 trainer-off`). Every route names a link
  by id; one that is not an active link of the caller's, in the role the route needs, is a
  `404 not-found`, the same answer whether it exists or not, audited as `.denied`.
- No route takes a user id. An account nobody linked (the operator's) cannot be named at all.
- Ending a link needs only a session, so a trainer who switched tools off can still end one.

### Assignments

- **Draft and publish.** A trainer picks a programme (the draft, with a note) and publishes it.
  Every trainer write takes `baseRev` (and `baseWid`), with `PUT /api/data`'s semantics: a stale
  one is a `409` carrying the current assignment. The server builds the snapshot from the
  trainer's own library and never takes one sent to it. The last ten published revisions are
  kept. Library edits change nothing for a client until the trainer publishes again.
- **The push** says "Plan update from your trainer" and "Open openGym to load it." (or "to
  review it."), with `url: '#/trainer'`. No names, exercises or notes.
- **The acknowledgement** records the revision the client applied or discarded, and the routine
  ids it now holds for the link. It moves no revision of the trainer's, so it never makes the
  trainer's next write a conflict. For `applied`, the ids must be that revision's; for
  `discarded`, ones the link delivered. Either way what the trainer may read never widens.

### Delivery in the app

`TrainerInbox`, always mounted, starts once the module is on, someone is signed in and the store's
first pull is done. It asks `GET /api/trainer/assignment` on start, on focus, when the page
becomes visible, every 60 seconds, and when the trainer page asks (after Accept or a mode
switch). A published revision newer than the one applied or discarded is:
- **trainer-managed:** applied at once, with a toast that offers Undo;
- **co-managed:** offered on a card with the trainer's note and the diff (routines and exercises
  added, removed or changed, exercise revisions), with Apply, Discard and Later.

Nothing is applied or offered while a workout is running; it waits for the workout to end.

**Applying** (`delivery.js`) is the client's app changing its own profile through the store's
`update()`, then its own sync (`PUT /api/data`, with its revision):
1. An undo copy of routines, week and reschedules, in memory. It is the module's own, not the
   Coach's `pushSnapshot`/`revertLast`: those keep their stack in the Coach's namespace, where the
   Coach's "Undo the last Coach changes" would undo a trainer's plan and `revertLast` writes a
   Coach message.
2. `applySnapshot` with the routines recorded for the previous revision.
3. Each demo file (and poster) the snapshot names and the client's media folder lacks (upstream's
   `POST /api/media/missing`) is downloaded from the trainer's demo store and uploaded through
   upstream's own `PUT /api/media/<hash>`. From then on it is the client's own file.
4. The acknowledgement. One that fails is kept on the device and sent first at the next check,
   so nothing is applied twice.

**Undo** puts routines, week and reschedules back, and acknowledges the revision as discarded, so
the trainer sees it. Delivered exercises stay, as after a Coach revert.

**Discard** only acknowledges. Nothing in the profile changes.

**Never touched:** personal routines, workouts, weigh-ins, settings, other custom exercises, the
Coach's data. **The week and any schedule are not changed in this MVP**: a programme's week is
not applied, and the client puts the delivered routines on days as they like. The one exception is
upstream's `deleteRoutine`, which takes a routine that a new revision dropped off the week.

**After the link ends**, the delivered routines stay as ordinary routines, with their history and
the demo copies. A new link to the same trainer replaces them in place.

### Progress

`GET /api/trainer/progress?link=` reads the client's state with upstream's `readStateStrict`
(read-only) and returns:
- finished workouts on a routine the link delivered (the acknowledged routines and every retained
  published snapshot's), finished since the link began, newest first, at most 100;
- per workout: date, start, duration, the routines' names (the trainer's own), and per exercise
  the sets with weight, reps, time, effort (RIR or RPE), done and warm-up, plus the client's own
  notes on the session and on each exercise, where upstream keeps them;
- the profile's unit, without which no weight can be read;
- body weight (each workout's `bw`, and the weigh-ins since the link began) only when the client
  shares it.

Never: media refs, photos or videos, any other setting, credentials, workouts of other routines,
personal routines, the names of the client's own custom exercises. A session that combined a
delivered routine with one of the client's own shows only the delivered routine's entries, and not
its session note. Each read is audited with ids and counts.

### What is stored

| Path | Contents |
|---|---|
| `DATA_DIR/trainer/links.json` | `{ v: 1, invites: [{ id, trainer, hash, createdAt, expiresAt, usedAt?, usedBy?, link?, revokedAt? }], links: [{ id, trainer, client, mode, scopes, shareBodyweight, createdAt, revokedAt?, revokedBy? }] }`. Closed invites are dropped a month after they closed. |
| `DATA_DIR/trainer/assignments/<linkId>.json` | `{ v: 1, rev, wid, draft: { programmeId, note } \| null, published: [{ rev, at, programmeId, programmeRev, snapshot, note }], applied: { rev, at, outcome, routineIds } \| null }`. |

A `links.json` or assignment file that cannot be parsed is never replaced: writes answer `503`,
and the demo sweep keeps every file of that trainer.

### Clean-up of deleted profiles

Beside the hourly demo sweep (and five minutes after boot), `cleanup.js` removes:
- invites of a trainer who is gone;
- links naming a trainer or client who is gone, and their assignment files;
- assignment files of an ended link, or one `links.json` does not know;
- a gone trainer's library, demo files and switch.

It never acts when the user list is empty, and nothing that depends on `links.json` happens when
that file is missing or unreadable. A client keeps what it applied, demo copies included.

### Audit (FIT-004)

`trainer.invite.create`, `.revoke`; `trainer.link.accept`, `.update`, `.revoke`;
`trainer.assignment.draft`, `.publish`, `.ack`; `trainer.progress.read`; and
`trainer.invite.denied`, `trainer.link.denied`, `trainer.assignment.denied`,
`trainer.progress.denied`. Each records user ids, link and invite ids, revisions, modes and counts.
Never a code, a name, a note or any content.

## Data contract

An applied assignment leaves a marker on the client's own routines: `assigned: { by,
assignmentId, rev }`. A delivered custom exercise keeps the trainer's stable `tx_` id as its own
id, and carries `src: { trainer, exRev }`. Both are pinned through the same paths as the marker
(store load and heal, unit switch, the sync merge, the server's stamping, `parsePlan`). The client's app applies
the assignment and syncs it through the normal revision machinery. `frontend/src/trainer/contract.test.js`
and `api/trainer/test/` establish how upstream treats that marker. These are the design rules
that follow from it.

**Where the marker survives:**
- **(a) Store load and heal.** It survives `update()`, a cold start from `localStorage`,
  `healCustomEx`, `restoredStateFor`, a unit switch (`convertStateUnit`) and a backup import.
- **(b) Sync merge.** It survives `mergeStates`. It is merged per field like any other field: a
  rename on one device and a new revision on another are both kept. `prefer` (sign-in) and
  removals behave as for any routine.
- **(c) Server stamping.** It survives `PUT /api/data`. It is stored as sent. When a writer that
  does not stamp changes it, it is stamped per field. When such a writer (an older app, an API
  script) leaves it out, it is put back (`sync-stamps.js` `keepUnknown`). When the app itself
  removes it, the removal goes through.
- **(d) RoutineEdit.** It survives rename, emoji, progression and the deload switch, none of which
  stamps it as changed.

**Where it does not, and what the module does about it:**
- **Exercise slots.** RoutineEdit rebuilds an exercise slot from the config sheet when that
  exercise is edited (`{ id, sg, ...cfg }`), so extra fields on a slot are dropped. The module
  keeps nothing on exercise slots.
- **Copies.** `copyRoutine` copies the marker onto the copy. A routine counts as delivered only if
  its id is one the module recorded, never by the marker alone.
- **`mergePlan`.** It mints fresh ids, rebuilds routines from a whitelist (dropping the marker) and
  reuses a client's custom exercise of the same name. It cannot replace an earlier revision.
  Applying an assignment is therefore the module's own replace-in-place, built on `parsePlan`
  (which keeps unknown fields and converts units), `pushSnapshot`, `deleteRoutine` and the store's
  `update()`. It uses stable routine ids, so workout history and progression stay attached across
  revisions.
- **Sharing.** `buildPlanBundle` (Share plan) leaves the marker out, so a client sharing their plan
  shares no trainer data.
- **Snapshots.** `pushSnapshot`/`revertLast` cover routines and week, not custom exercises, and
  write to the Coach's log.

## How the sync works

`.github/workflows/dozzly-sync.yaml` has two jobs.

### release (daily at 05:17 UTC, and by hand)

1. Fast-forwards `main` to upstream `main`. A diverged `main` is reported and left alone.
2. Reads `dozzly/UPSTREAM`: the upstream base, either a release tag or an upstream `main` commit
   when the branch was brought up to upstream `main` between releases. It then looks for the newest
   upstream `vX.Y.Z` tag. If the base does not contain that release yet, it runs
   `git rebase --onto <new> <old> dozzly/trainer` and writes the new tag into `dozzly/UPSTREAM`
   (as a fixup, so the history stays release + seam + module).
3. Runs `dozzly/test.sh`. That covers upstream's own CI commands from `.github/workflows/test.yml`
   (frontend, build, locale checks, fatigue probe, MCP, api, generated-file checks) and the
   module's api and web tests, on Node 22.
4. Builds the api image's `default` target and smoke-tests it. The image must boot, serve
   `/api/config`, contain no AI runtime, and answer `/api/trainer/status` with 404 when off and
   401 when on.
5. Builds and pushes `ghcr.io/dozzly/opengym-api` (upstream's default target, the one the cluster
   runs today) and `ghcr.io/dozzly/opengym-web` as `<version>-dozzly.<n>`, and moves the plain
   `<version>` tag to the same build (the cluster pins `<version>@<digest>`, so version-checker
   compares it with upstream's releases), for linux/amd64 only
   (the cluster's only architecture; emulating arm64 on a one-CPU runner is not worth it). The web
   build shows `<version>+dozzly.<n>` in the app.
6. Pushes `dozzly/trainer` (`--force-with-lease`) and the `dozzly/build/<tag>` tag in one atomic
   push.
7. Writes both digests into the run summary. The digest-pin pull request against
   `apps/fitness/deployment.yaml` is opened from `dozzly/dozzly-cluster`'s side, with that
   repository's own token, so this fork holds no credential for the cluster repository. Until
   that workflow exists, the digests are pinned from the summary by hand. The operator merges
   either way.

**Builds follow releases.** A build is named after the newest release its base contains. It is
refused when the base differs from that release in anything that goes into the images (`api/`
except `openapi.yaml`, `frontend/`, `web/`). Bringing the branch up to upstream `main` therefore
never ships unreleased upstream code. Do it by hand with
`git rebase --onto upstream/main <base> dozzly/trainer`, then write the new base commit into
`dozzly/UPSTREAM`.

**What triggers a build:**
- On a schedule, a new upstream release.
- On a schedule, module work merged since the last published build. That is, the image paths
  (`api/` except `openapi.yaml`, `frontend/`, `web/`) differ from the commit the newest
  `dozzly/build/*` tag names.
- By hand, with **build** ticked, at any time.

**On failure.** A rebase conflict, a failing suite or a failed build opens an issue here, or
comments on the open one. Nothing is pushed or built.

### main-check (nightly at 01:43 UTC)

Runs the same rebase onto upstream `main` HEAD, and the same tests. It never pushes, builds or
deploys. A failure opens an "early warning" issue; the next passing run closes it.

## When the sync opens an issue

**Rebase conflict.** Only seam lines can conflict. Resolve with Node in Docker; the host needs
none:

```sh
git fetch upstream --tags
git switch dozzly/trainer
old=$(cat dozzly/UPSTREAM); new=vX.Y.Z
git rebase --onto "$new" "$old"        # re-apply the one conflicting seam line, then: git rebase --continue
printf '%s\n' "$new" > dozzly/UPSTREAM
git commit --fixup="$(git log -n1 --format=%H -- dozzly/UPSTREAM)" -- dozzly/UPSTREAM
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash "$new"
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/w -w /w node:22-alpine sh dozzly/test.sh
git push --force-with-lease origin dozzly/trainer
```

Then run the workflow by hand with **build** set. If the seam itself moved, update
`dozzly/seam-replay.sh` (`apply_seam`) and this file to match.

**Failing contract test.** This is the warning ADR 029 cares about: upstream changed something
the module relies on. Fix the module, usually in `adapter.js`, in a new module commit. Never edit
upstream files to make it pass.

**Failing upstream suite.** Check whether upstream's own CI fails on the same release. If it does,
wait for upstream's fix.

## Rolling back

From cheapest to widest (ADR 029):

1. **Switch the module off.** Remove `TRAINER` from the api container. The routes return 404 and
   the app hides the module. Clients keep their last assigned plan as ordinary routines.
2. **Return to upstream's images.** Revert the cluster pull request, or pin
   `ghcr.io/duartesantos8/opengym-{api,web}` at the same upstream version as the fork build (the
   digests are in the pull request body). A newer version also works; an older one never does.
   Upstream ignores `DATA_DIR/trainer/`, and assigned routines are ordinary routines to it.
3. **Remove the module's data.** Delete `DATA_DIR/trainer/` after a backup.

Take a backup before every image change, as `apps/fitness/README.md` in the cluster repository
requires.

## Licence and source offer

openGym is AGPL-3.0-or-later, and so is everything added here (`LICENSE`, `NOTICE.md` unchanged).
Network users of the instance get this source as follows (section 13):

- The app's "Source code" link points at this public repository.
- The default branch, `dozzly/trainer`, is what runs.
- Each image's `org.opencontainers.image.source` and `revision` labels, and its
  `dozzly/build/<tag>` tag, name the exact commit it was built from.

Keep the repository public while the instance serves anyone.

## One-time setup for the owner

Creating the repository and the packages are owner-approved steps (ADR 029, phase 1). After
approval:

1. **Create the fork and push.** Fork `DuarteSantos8/openGym` to `dozzly/opengym` (public). Push
   `dozzly/trainer` from the prepared local repository and make it the **default branch**
   (Settings, Branches). Scheduled workflows only run from the default branch.
2. **Give the cluster's runners access.** The sync runs on the `opengym` runner scale set in the
   homelab cluster (`dozzly/dozzly-cluster`,
   `infrastructure/ci/actions-runner-controller/runnerset-opengym-helmrelease.yaml`):
   - Add `dozzly/opengym` to the repositories of the ARC GitHub App installation (GitHub,
     Settings, Applications, the ARC app, Configure, Repository access).
   - Merge the dozzly-cluster pull request that adds the runner set. The repository then lists
     `opengym` under Settings, Actions, Runners.
3. **Enable Actions, and protect the self-hosted runner.** Actions are off in a new fork until
   you confirm them in the Actions tab. Then, in Settings, Actions, General:
   - **Fork pull request workflows from outside collaborators:** "Require approval for all
     outside collaborators". This is a public repository with a self-hosted runner. A pull
     request can bring its own workflow with `runs-on: opengym`, so nothing from a stranger may
     run on the cluster without approval.
   - Leave the default workflow permissions at "Read repository contents". The sync declares
     the extra permissions it needs per job.
4. **Disable all four of upstream's workflows** (Actions, select the workflow, then "Disable
   workflow"). The fork carries them, and they would run from the copies on `main` whenever the
   sync fast-forwards it. They target GitHub's hosted runners, and the sync already runs
   upstream's test commands on the cluster:

   | Workflow | Why disable it |
   |---|---|
   | `docker-publish.yml` (Publish Docker images) | On a push to `main` it would publish upstream `main` as `ghcr.io/dozzly/opengym-{api,web}:edge`, into the same packages as the fork builds. |
   | `pages.yml` (Deploy demo to GitHub Pages) | Tries to publish upstream's demo to this repository's Pages. |
   | `test.yml` (Tests) | Duplicates `dozzly/test.sh`, on GitHub-hosted runners. |
   | `mirror.yml` (Mirror to GitLab) | Already skips itself outside upstream; disable for tidiness. |

   `.gitea/workflows/` and `.gitlab-ci.yml` are not run by GitHub. Leave Dependabot version
   updates off and don't install Renovate on the fork; their configuration is upstream's.
5. **Enable Issues.** Forks start with Issues off (Settings, Features). The sync reports through
   them.
6. **Add the deploy key.**
   1. Run `ssh-keygen -t ed25519 -N '' -C dozzly-opengym-sync -f opengym_sync`.
   2. Add `opengym_sync.pub` under Settings, Deploy keys, with **write access**.
   3. Store the private half (`opengym_sync`) as the Actions secret `FORK_DEPLOY_KEY`, then
      delete both local files.

   A deploy key, not `GITHUB_TOKEN`: GitHub refuses a `GITHUB_TOKEN` push that changes
   `.github/workflows/*`, and both the fast-forward of `main` and every rebase onto upstream carry
   upstream's workflow changes. The key reaches this one repository only. Running on the
   cluster's runners does not change this, because the token GitHub issues to the job is the same.
7. **Run the first build.** Actions, "dozzly: follow upstream releases", Run workflow, mode
   `release`, **build** checked. It builds `1.3.10-dozzly.1`. With one CPU per runner container
   (the cluster's `arc-runners` LimitRange), expect a long first run.
8. **Publish the packages.** After the first build, open `opengym-api` and `opengym-web` under the
   account's Packages:
   - Set each to **Public**, so the cluster pulls without credentials.
   - Check that each is linked to `dozzly/opengym`, with Actions write access.
9. **Merge with the gates in mind.** Pinning the fork build in the cluster is the FIT-006 deploy
   step:
   - It needs FIT-002 (the 1.3.10 baseline).
   - The fork build must behave like upstream 1.3.10 on the live data before the module is ever
     switched on.

GitHub disables a public repository's scheduled workflows after 60 days without activity. The
sync's own pushes count as activity while upstream moves. If it is ever disabled, re-enable it in
the Actions tab.

## Working on the module

- **Follow upstream's rules** (`CONTRIBUTING.md`): no new dependencies, plain JavaScript, tests
  beside the code.
- **Words go in `frontend/src/trainer/strings.js`**, not upstream's `t()` catalogue.
- **Upstream internals only through `adapter.js`**, with a contract test for each new one.
- **Run the tests without Node on the host:**
  - all suites: `docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/w -w /w node:22-alpine sh dozzly/test.sh`
  - module api tests only: `cd api && node --test trainer/test/*.test.js`
  - module web tests only: `cd frontend && npx vitest run src/trainer`
- **Known gaps:**
  - Upstream's in-app "update available" notice still points at upstream's releases.
  - The native Android and iOS apps are out of scope (ADR 029).
  - The trainer screens are English only (`strings.js`).
  - The programme editor does not edit the week, progression rules or slot order. A programme
    keeps whatever week it has, and new ones have none.
  - FIT-004: the week is not applied (above). Upstream's service worker ignores a push's `url`,
    so tapping the notification opens the app's start page, not `#/trainer`. Undo lives in the
    toast (in memory, on the device that applied). Two devices of one client that look at the
    same moment may both apply the same revision; stable ids make that the same result, with two
    undo copies. Demo copies happen while the client's app is open; a failed copy is retried at
    the next check. Progress counts workouts since the link began only.

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
| `api/trainer/` | Server half: `routes.js`, a route factory like `api/coach/routes.js`, and its tests in `test/`. |
| `frontend/src/trainer/` | App half. It holds `TrainerRoot.jsx`, `TrainerInbox.jsx` and `adapter.js`, the only file here that reaches into upstream internals. `contract.test.js` pins those internals. |
| `dozzly/` | This file. `UPSTREAM` is the release the branch is based on. `test.sh` runs every suite. `seam-replay.sh` is the seam durability check. |
| `.github/workflows/dozzly-sync.yaml` | The sync, test, build and deploy-proposal workflow. |

## The seam

These are the only edits to upstream-owned files, all in one commit
(`dozzly: seam - hook points for the trainer module`). The budget is about 15 changed lines
(ADR 029, decision 3). This seam is 8: 6 added and 2 changed (`git diff --stat`: 5 files, +8 −2).

| File | Lines | What and where |
|---|---|---|
| `api/server.js` | +2 | `import { trainerRoutes } from './trainer/routes.js';` on the line after the `coachRoutes` import. `...trainerRoutes({ … }),` on the line before `...coachRoutes({ json, readBody, readSession, requireAdmin }),`. |
| `api/Dockerfile` | +1 | `COPY trainer ./trainer` after `COPY coach ./coach`. |
| `frontend/src/App.jsx` | +3 | The import after the `react-router-dom` import. `<Route path="/trainer/*" …/>` directly after `<Routes>`. `<TrainerInbox />` between `<Toast />` and `<TimerFlash />`. |
| `frontend/src/views/Settings.jsx` | ±1 | The "Source code" link points at this repository ([licence](#licence-and-source-offer)). |
| `frontend/src/views/Settings.reset.test.jsx` | ±1 | Upstream's test that pins that link's address (since v1.3.9) expects this repository, so upstream's own suite stays green. |

**The helpers object.** The route spread hands the module one object holding everything it is
expected to need: `json`, `readBody`, `readSession`, `requireAdmin`, `audit`, `readStateStrict`,
`UNREADABLE`, `atomicWrite`, `dataDir`, `sendPush`, `HttpError`, `media` (the media store, or
`null` with uploads off), `sendMediaFile` and `users()`. Passing everything now means the line
rarely has to change. `api/trainer/test/seam.test.js` checks that every one of these is still
declared in `server.js`.

**No Settings entry, on purpose.** ADR 029 allows one Settings row. Any wording would be a new
`t()` string, and upstream's CI requires every such string in all 17 locale packs. Rendering a
row from the module needs an import plus a line in a file upstream is redesigning right now
(`views/settings-pages.js`, v1.3.11). The module's own pages are at `#/trainer`, and its
inbox is mounted app-wide.

**Durability.** `dozzly/seam-replay.sh v1.2.15 upstream/main` applies this exact seam at v1.2.15
and rebases it across every later release. On 2026-10-08 the result was:

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
`{ "enabled": true, "module": "<version>" }` when signed in.

**Storage.** The module's store will be `DATA_DIR/trainer/`; nothing is written there yet. The
module never writes `state-<uid>.json`, `db.json` or another profile's upload folder
(ADR 029, decision 4).

## Data contract

An applied assignment leaves a marker on the client's own routines and custom exercises:
`assigned: { by, assignmentId, rev }`, plus `exId` on a custom exercise. The client's app applies
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
2. Reads `dozzly/UPSTREAM` and looks for the newest upstream `vX.Y.Z` tag. If it is newer, runs
   `git rebase --onto <new> <old> dozzly/trainer` and writes the new tag into `dozzly/UPSTREAM`
   (as a fixup, so the history stays release + seam + module).
3. Runs `dozzly/test.sh`. That covers upstream's own CI commands from `.github/workflows/test.yml`
   (frontend, build, locale checks, fatigue probe, MCP, api, generated-file checks) and the
   module's api and web tests, on Node 22.
4. Builds the api image's `default` target and smoke-tests it. The image must boot, serve
   `/api/config`, contain no AI runtime, and answer `/api/trainer/status` with 404 when off and
   401 when on.
5. Builds and pushes `ghcr.io/dozzly/opengym-api` (upstream's default target, the one the cluster
   runs today) and `ghcr.io/dozzly/opengym-web` as `<version>-dozzly.<n>`, for linux/amd64 only
   (the cluster's only architecture; emulating arm64 on a one-CPU runner is not worth it). The web
   build shows `<version>+dozzly.<n>` in the app.
6. Pushes `dozzly/trainer` (`--force-with-lease`) and the `dozzly/build/<tag>` tag in one atomic
   push.
7. Writes both digests into the run summary. The digest-pin pull request against
   `apps/fitness/deployment.yaml` is opened from `dozzly/dozzly-cluster`'s side, with that
   repository's own token, so this fork holds no credential for the cluster repository. Until
   that workflow exists, the digests are pinned from the summary by hand. The operator merges
   either way.

**What triggers a build:**
- On a schedule, a new upstream release.
- By hand, set **build** to also build the current branch (the first build, or new module
  commits).

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
  - Trainer demo files in the trainer's own upload folder are swept like any unreferenced upload,
    so FIT-003 has to keep them referenced or stored by the module.

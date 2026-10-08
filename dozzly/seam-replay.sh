#!/usr/bin/env bash
# Seam replay for dozzly/opengym (FIT-006). Adapted from the replay ADR 029 cites.
#
# Applies the dozzly/opengym seam (the exact lines of the seam commit on dozzly/trainer) at a
# start tag, then rebases it onto every later upstream release and finally upstream main, and
# reports per step whether git rebased it cleanly. On a conflict the rebase is aborted and the
# seam is applied again on that release (what a human fixing it would do), so every row says
# whether *that* release would have needed a hand.
#
# Usage, from the repository root: dozzly/seam-replay.sh <start-tag> [<main-ref>]
#   e.g. dozzly/seam-replay.sh v1.2.15 upstream/main   (needs upstream's tags fetched)
# Keep apply_seam below identical to the seam commit (APPLY_ONLY=1 prints what it applies).
# Works in a throwaway clone; this repository is only read.
set -u
src=$(git rev-parse --show-toplevel); start=$1; mainref=${2:-upstream/main}
work=$(mktemp -d /tmp/seam-replay-XXXXXX)
trap 'rm -rf "$work"' EXIT
# The main ref may be a remote-tracking ref of the source (upstream/main), which a clone does
# not copy: resolve it there, and bring the source's remote-tracking refs along for the objects.
mainsha=$(git -C "$src" rev-parse --verify "$mainref^{commit}") || { echo "unknown ref $mainref"; exit 1; }
git clone -q --no-checkout "$src" "$work/repo"
cd "$work/repo"
git fetch -q "$src" '+refs/remotes/*:refs/remotes/src/*'
git -c advice.detachedHead=false checkout -q "$start" -b seam
G() { git -c user.name=replay -c user.email=replay@localhost "$@"; }

apply_seam() {
  # api/server.js: import beside coachRoutes, spread on the line before the Coach's spread.
  sed -i "/^import { coachRoutes } from '.\/coach\/routes.js';/a import { trainerRoutes } from './trainer/routes.js';" api/server.js
  sed -i "/^  \.\.\.coachRoutes({ json, readBody, readSession, requireAdmin })/i \  ...trainerRoutes({ json, readBody, readSession, requireAdmin, audit, readStateStrict, UNREADABLE, atomicWrite, dataDir: DATA, sendPush, HttpError, media: MEDIA_ON ? MEDIA : null, sendMediaFile, users: () => db.users })," api/server.js
  # api/Dockerfile
  sed -i "/^COPY coach .\/coach\$/a COPY trainer ./trainer" api/Dockerfile
  # frontend/src/App.jsx: import, route right after <Routes>, inbox after <Toast />.
  sed -i "/^import { HashRouter/a import { TrainerRoot, TrainerInbox } from './trainer/index.js'" frontend/src/App.jsx
  sed -i "0,/^ *<Routes>\$/{/^ *<Routes>\$/a \              <Route path=\"/trainer/*\" element={<TrainerRoot />} />
}" frontend/src/App.jsx
  sed -i "/^      <Toast \/>\$/a \      <TrainerInbox />" frontend/src/App.jsx
  # frontend/src/views/Settings.jsx: the source link (gitlab before v1.3.9, github since).
  sed -i -E 's#<a href="https://(gitlab|github)\.com/DuarteSantos8/open[Gg]ym" target="_blank" rel="noopener">(source code|\{t\(.Source code.\)\})</a>#<a href="https://github.com/dozzly/opengym" target="_blank" rel="noopener">\2</a>#' frontend/src/views/Settings.jsx
  # …and upstream's test that pins that link (since v1.3.9), so upstream's own suite stays green.
  if [ -f frontend/src/views/Settings.reset.test.jsx ]; then
    sed -i "s#expect(link.getAttribute('href')).toBe('https://github.com/DuarteSantos8/openGym')#expect(link.getAttribute('href')).toBe('https://github.com/dozzly/opengym')#" frontend/src/views/Settings.reset.test.jsx
  fi
  mkdir -p api/trainer frontend/src/trainer
  printf '%s\n' "export const trainerRoutes = () => ({});" > api/trainer/routes.js
  printf '%s\n' "export const TrainerRoot = () => null" "export const TrainerInbox = () => null" > frontend/src/trainer/index.js
  G add -A && G commit -qm seam
}
seam_files="api/server.js api/Dockerfile frontend/src/App.jsx frontend/src/views/Settings.jsx frontend/src/views/Settings.reset.test.jsx"
check_seam() {   # every hook line present exactly once
  local n=0
  n=$((n + $(grep -c "^import { trainerRoutes } from './trainer/routes.js';" api/server.js)))
  n=$((n + $(grep -c '^  \.\.\.trainerRoutes({' api/server.js)))
  n=$((n + $(grep -c '^COPY trainer ./trainer$' api/Dockerfile)))
  n=$((n + $(grep -c "^import { TrainerRoot, TrainerInbox } from './trainer/index.js'" frontend/src/App.jsx)))
  n=$((n + $(grep -c '<Route path="/trainer/\*" element={<TrainerRoot />} />' frontend/src/App.jsx)))
  n=$((n + $(grep -c '^      <TrainerInbox />$' frontend/src/App.jsx)))
  n=$((n + $(grep -c 'href="https://github.com/dozzly/opengym"' frontend/src/views/Settings.jsx)))
  # the pinned link in upstream's test, where that test exists
  if grep -q "links the source code" frontend/src/views/Settings.reset.test.jsx 2>/dev/null; then
    grep -q "toBe('https://github.com/dozzly/opengym')" frontend/src/views/Settings.reset.test.jsx || return 1
  fi
  [ "$n" = 7 ]
}

apply_seam
check_seam || { echo "seam did not apply at $start"; exit 1; }
# APPLY_ONLY=1: print the seam as applied (to compare with the real seam commit) and stop.
if [ -n "${APPLY_ONLY:-}" ]; then git diff "$start" HEAD -- $seam_files; exit 0; fi
echo "seam at $start: $(git diff --shortstat "$start" -- $seam_files)"
printf '%-8s %-9s %-7s %s\n' release result commits detail
prev=$start
for t in $(git tag --sort=v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n "/^$start\$/,\$p" | tail -n +2) "$mainsha"; do
  n=$(git rev-list --count "$prev..$t")
  label=$t; [ "$t" = "$mainsha" ] && label=main
  if G rebase -q "$t" >/dev/null 2>&1 && check_seam; then
    printf '%-8s %-9s %-7s\n' "$label" clean "$n"
  else
    files=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
    G rebase --abort >/dev/null 2>&1
    git -c advice.detachedHead=false checkout -q -B seam "$t"
    apply_seam
    check_seam && fix="re-applied by hand" || fix="RE-APPLY FAILED"
    printf '%-8s %-9s %-7s %s\n' "$label" CONFLICT "$n" "in: ${files:-?} ($fix)"
  fi
  prev=$t
done

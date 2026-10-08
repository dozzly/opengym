#!/bin/sh
# Every check a dozzly/opengym build has to pass: upstream's own CI commands, copied from
# .github/workflows/test.yml (jobs `test`, `mcp` and `api`; the image job is the workflow's smoke
# test), and the trainer module's tests. Run from the repository root on Node 22, the version of
# upstream's CI and of both Dockerfiles. Every stage runs; the exit status says whether all passed.
#
#   dozzly/test.sh              install with npm ci, then test
#   dozzly/test.sh --no-install test what is installed
#
# Without Node on the host, in the image the api and web builds use:
#   docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/w -w /w node:22-alpine sh dozzly/test.sh
#
# DOZZLY_REPORT names a file that gets one markdown line per stage (the workflow's summary and
# the body of the issue it opens on a failure).
set -u
report=${DOZZLY_REPORT:-/dev/null}
failed=0
stage() {
  name=$1; shift
  echo "::group::$name"
  if "$@"; then res=ok; else res=FAILED; failed=1; fi
  echo "::endgroup::"
  echo "$name: $res"
  echo "- \`$name\`: $res" >> "$report"
}
install_deps() {
  (cd frontend && npm ci --no-audit --no-fund) &&
  (cd mcp && npm ci --no-audit --no-fund) &&
  # The Agent SDK is optional and stays out, as in upstream's api job.
  (cd api && npm ci --omit=optional --no-audit --no-fund) &&
  npm ci --no-audit --no-fund
}

[ "${1:-}" = --no-install ] || stage install install_deps

# upstream: job `test`
stage frontend-test sh -c 'cd frontend && npm test'
stage frontend-build sh -c 'cd frontend && npm run build'
stage check-locales sh -c 'cd frontend && node scripts/check-locales.mjs'
stage check-source-strings sh -c 'cd frontend && node scripts/check-source-strings.mjs'
stage fatigue-probe sh -c 'cd frontend && npm run test:fatigue-probe'
# upstream: job `mcp`
stage mcp-test sh -c 'cd mcp && npm test'
stage mcp-loadable sh -c 'cd mcp && npm run check:node-loadable'
# upstream: job `api`
stage api-test sh -c 'cd api && npm test'
stage coach-assets node scripts/build-coach-assets.mjs --check
stage api-docs node scripts/build-api-docs.mjs --check
stage core-loadable node api/scripts/check-core-loadable.mjs
# the trainer module (its frontend tests also ran inside frontend-test; named here on their own)
stage module-api sh -c 'cd api && node --test trainer/test/*.test.js'
stage module-web sh -c 'cd frontend && npx vitest run src/trainer'

[ "$failed" = 0 ] && echo "all stages passed" || echo "a stage failed"
exit "$failed"

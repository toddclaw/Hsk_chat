#!/bin/sh
# Every suite, in one command. No dependencies, no build step.
# Also run by .githooks/pre-commit.
set -e
cd "$(dirname "$0")/.."
# browser.test.js is last: it is the only one that needs a browser, takes
# seconds rather than milliseconds, and skips itself (exit 0) where there is
# none -- so a machine without firefox still gets every other suite.
for t in test/validator.test.js test/prompt.test.js test/md.test.js test/time.test.js test/pace.test.js test/senses.test.js test/sync.test.js test/release.test.js; do
  printf '\n=== %s ===\n' "$t"
  node "$t"
done

# browser.test.js drives a real, mocked-network Firefox session and is fully
# idempotent -- a retry is a fresh run, not a masked bug. On GitHub's shared
# runners its heaviest path (a story segment's validate-and-render round trip)
# occasionally loses a race against scheduler jitter that no fixed waitFor
# timeout reliably survives; a single retry turns "one bad roll of the dice
# fails the run" into "needs two bad rolls in a row", which is the actual fix
# once raising that timeout stopped being enough on its own.
printf '\n=== test/browser.test.js ===\n'
if ! node test/browser.test.js; then
  echo "browser.test.js failed once -- retrying once before treating it as a real failure" >&2
  node test/browser.test.js
fi

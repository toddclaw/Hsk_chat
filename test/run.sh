#!/bin/sh
# Every suite, in one command. No dependencies, no build step.
# Also run by .githooks/pre-commit.
set -e
cd "$(dirname "$0")/.."
# browser.test.js is last: it is the only one that needs a browser, takes
# seconds rather than milliseconds, and skips itself (exit 0) where there is
# none -- so a machine without firefox still gets every other suite.
for t in test/validator.test.js test/prompt.test.js test/md.test.js test/pace.test.js test/senses.test.js test/sync.test.js test/release.test.js test/browser.test.js; do
  printf '\n=== %s ===\n' "$t"
  node "$t"
done

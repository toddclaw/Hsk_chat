#!/bin/sh
# Every suite, in one command. No dependencies, no build step.
# Also run by .githooks/pre-commit.
set -e
cd "$(dirname "$0")/.."
for t in test/validator.test.js test/prompt.test.js test/pace.test.js test/release.test.js; do
  printf '\n=== %s ===\n' "$t"
  node "$t"
done

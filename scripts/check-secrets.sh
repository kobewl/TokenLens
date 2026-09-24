#!/bin/sh
# Refuse staged secrets and test files. This is a commit guard, not a test suite.
set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "check-secrets: not a git repository" >&2
  exit 1
fi

staged=$(git diff --cached --name-only --diff-filter=ACMR)
if [ -z "$staged" ]; then
  exit 0
fi

blocked=0
for file in $staged; do
  case "$file" in
    tests/*|test/*|__tests__/*|fixtures/*|testdata/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*_test.rs|*.env|*.env.*)
      echo "blocked test or secret file: $file" >&2
      exit 1
      ;;
  esac
done

# Scan added lines. Skip this guard's own pattern list.
if git diff --cached -U0 -- . ':(exclude)scripts/check-secrets.sh' ':(exclude)SECURITY.md' \
  | grep -E '^\+' \
  | grep -E 'sk-ant-|sk-proj-|BEGIN PRIVATE KEY|AKIA[0-9A-Z]{16}' >/dev/null; then
  echo "blocked: staged diff looks like a credential" >&2
  exit 1
fi

exit "$blocked"

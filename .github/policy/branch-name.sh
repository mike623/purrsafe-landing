#!/usr/bin/env bash
# Validates that a branch name is owned by exactly one Paperclip issue, and
# that the PR text actually references the issue the branch name claims.
#
# Usage: branch-name.sh <branch> <title> <body>
# Exits 0 on pass, 1 on violation. Shared by CI and .github/policy/selftest.sh
# so the rule cannot drift between what CI runs and what we test.
set -u

branch=${1-}
title=${2-}
body=${3-}

# <type>/pur-<n>-<slug>: one branch per issue, issue id in the name.
if ! printf '%s' "$branch" | grep -qE '^(feat|fix|chore|design|docs|refactor|test)/pur-[0-9]+-[a-z0-9]+(-[a-z0-9]+)*$'; then
  echo "::error::branch '$branch' must match <type>/pur-<issue>-<slug>, e.g. fix/pur-155-canonical-host"
  exit 1
fi

issue=$(printf '%s' "$branch" | sed -E 's|^[a-z]+/pur-([0-9]+)-.*|\1|')

# [^0-9] rather than \b: BSD grep -E does not implement \b, and the only thing
# the boundary has to prevent is PUR-16 matching the string PUR-160.
if ! printf '%s\n%s\n' "$title" "$body" | grep -qiE "PUR-$issue([^0-9]|$)"; then
  echo "::error::branch claims PUR-$issue but neither the PR title nor body references it"
  exit 1
fi

echo "branch '$branch' is owned by PUR-$issue and the PR text references it"

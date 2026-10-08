#!/usr/bin/env bash
# Self-test for the branch and approval policy checks.
#
# Runs the same two implementations CI runs -- .github/policy/branch-name.sh and
# .github/policy/stale-approvals.jq -- against table-driven cases, including a
# fixture captured from the real PR #5 review payload. Run it locally with:
#   bash .github/policy/selftest.sh
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
pass=0
fail=0

ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); }

# want=pass|fail
check_branch() {
  local want=$1 desc=$2 branch=$3 title=$4 body=$5 out rc
  out=$(bash "$here/branch-name.sh" "$branch" "$title" "$body" 2>&1)
  rc=$?
  if [ "$want" = pass ] && [ $rc -eq 0 ]; then
    ok "$desc"
  elif [ "$want" = fail ] && [ $rc -ne 0 ]; then
    ok "$desc -> rejected: ${out#::error::}"
  else
    no "$desc (wanted $want, exit $rc): $out"
  fi
}

# want = expected stale-approval lines, newline separated ("" for none)
check_stale() {
  local desc=$1 head=$2 json=$3 want=$4 got
  # Same shape as the CI pipeline: a stream of review objects slurped into an
  # array, with the head SHA supplied through the environment.
  got=$(printf '%s' "$json" | jq -r '.[]' \
    | HEAD_SHA="$head" jq -s -r -f "$here/stale-approvals.jq")
  if [ "$got" = "$want" ]; then
    ok "$desc -> ${got:-<empty>}"
  else
    no "$desc: wanted [${want}] got [${got}]"
  fi
}

echo "branch-name.sh"
check_branch pass "well-formed branch, body references its own issue" \
  "fix/pur-155-canonical-host" "fix(PUR-155): canonical host" "Refs PUR-155."
check_branch fail "branch claims PUR-132 but body references PUR-149" \
  "fix/pur-132-canonical-host" "fix: canonical host" "Refs PUR-149."
check_branch fail "no issue, no type prefix" \
  "my-branch" "some change" "Refs PUR-155."
check_branch fail "missing type prefix" \
  "pur-155-canonical-host" "fix" "Refs PUR-155."
check_branch fail "uppercase slug" \
  "fix/pur-155-Canonical-Host" "fix" "Refs PUR-155."
check_branch fail "no issue number" \
  "fix/pur-canonical-host" "fix" "Refs PUR-155."
check_branch pass "this PR's own branch" \
  "feat/pur-160-branch-policy" "ci(PUR-160): branch policy" "Refs PUR-160."
# Guards the prefix-collision the [^0-9] boundary exists to stop.
check_branch fail "PUR-16 must not be satisfied by a body saying PUR-160" \
  "fix/pur-16-thing" "fix" "Refs PUR-160."
check_branch pass "issue id in the title alone is enough" \
  "fix/pur-155-canonical-host" "fix(PUR-155): canonical host" ""

echo "stale-approvals.jq"
pr5=$(cat "$here/fixtures/pr5-reviews.json")

check_stale "PR #5 fixture: approved 747d963, head advanced to 2343b72" \
  "2343b72b5f902ad9b5cb80b02db6e2c942264e70" "$pr5" \
  "mike623 approved 747d963caa87af521d23ac68327ed32f3c940697"

check_stale "PR #5 fixture evaluated at the approved SHA: not stale" \
  "747d963caa87af521d23ac68327ed32f3c940697" "$pr5" ""

check_stale "PR #8: no reviews at all" \
  "747d963caa87af521d23ac68327ed32f3c940697" "[]" ""

check_stale "native APPROVED state is still honoured" \
  "bbbbbbb" '[{"state":"APPROVED","body":"lgtm","user":{"login":"someone"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"}]' \
  "someone approved aaaaaaa"

check_stale "approve then request-changes leaves no phantom approval" \
  "ccccccc" '[
     {"state":"COMMENTED","body":"PRReviewer verdict: **Approve**","user":{"login":"r"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"},
     {"state":"CHANGES_REQUESTED","body":"no","user":{"login":"r"},"commit_id":"bbbbbbb","submitted_at":"2026-10-08T11:00:00Z"}
   ]' ""

check_stale "a later chatter comment does not retract the approval" \
  "ccccccc" '[
     {"state":"COMMENTED","body":"PRReviewer verdict: **Approve**","user":{"login":"r"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"},
     {"state":"COMMENTED","body":"one more thought on naming","user":{"login":"r"},"commit_id":"ccccccc","submitted_at":"2026-10-08T11:00:00Z"}
   ]' "r approved aaaaaaa"

check_stale "request-changes then approve is an approval again" \
  "ccccccc" '[
     {"state":"CHANGES_REQUESTED","body":"no","user":{"login":"r"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"},
     {"state":"COMMENTED","body":"PRReviewer verdict: Approve","user":{"login":"r"},"commit_id":"bbbbbbb","submitted_at":"2026-10-08T11:00:00Z"}
   ]' "r approved bbbbbbb"

check_stale "a Request changes verdict is not read as an approval" \
  "ccccccc" '[{"state":"COMMENTED","body":"## PRReviewer verdict: **Request changes**","user":{"login":"r"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"}]' \
  ""

check_stale "plain comment review is not a verdict" \
  "ccccccc" '[{"state":"COMMENTED","body":"drive-by note","user":{"login":"r"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"}]' \
  ""

check_stale "a dismissed approval does not lock the branch" \
  "ccccccc" '[{"state":"DISMISSED","body":"PRReviewer verdict: **Approve**","user":{"login":"r"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"}]' \
  ""

check_stale "an unsubmitted PENDING draft is not a verdict" \
  "ccccccc" '[{"state":"PENDING","body":"PRReviewer verdict: **Approve**","user":{"login":"r"},"commit_id":"aaaaaaa","submitted_at":null}]' \
  ""

check_stale "two reviewers, only the stale one is reported" \
  "ccccccc" '[
     {"state":"COMMENTED","body":"PRReviewer verdict: **Approve**","user":{"login":"a"},"commit_id":"aaaaaaa","submitted_at":"2026-10-08T10:00:00Z"},
     {"state":"APPROVED","body":"lgtm","user":{"login":"b"},"commit_id":"ccccccc","submitted_at":"2026-10-08T11:00:00Z"}
   ]' "a approved aaaaaaa"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

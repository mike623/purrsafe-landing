# Emits one line per stale approval: a reviewer whose newest verdict is an
# approval, recorded against a commit that is no longer the PR head.
# Input: a JSON array of review objects (GET /repos/{o}/{r}/pulls/{n}/reviews).
# Reads the current head from $ENV.HEAD_SHA so CI and a local run share code.
#
# Why this is not simply `select(.state == "APPROVED")`:
# every PR in this repository is opened by the same managed account that
# reviews it, and GitHub refuses self-approval ("Can not approve your own
# pull request"). PRReviewer therefore records its verdict as a COMMENTED
# review whose body opens with
#   PRReviewer verdict: <Approve|Request changes|Block>
# Matching only the native APPROVED state would make this check a permanent
# no-op here -- it would pass on PR #5, the exact drift it exists to catch.

# Classify a review into "approve", "reject", or null (no verdict: plain chatter).
#
# Approve is tested before reject on purpose. A misread that says "approve"
# locks the branch and demands a deliberate override label -- noisy but safe.
# A misread that says "no verdict" hides a stale approval, which is precisely
# the failure that stalled the release. Bias toward locking.
def verdict:
  (.body // "") as $body
  | if .state == "APPROVED" then "approve"
    elif .state == "CHANGES_REQUESTED" or .state == "DISMISSED" then "reject"
    elif $body | test("PRReviewer +verdict:[ *_]*Approve"; "i") then "approve"
    elif $body | test("PRReviewer +verdict:[ *_]*(Request +changes|Block|Reject)"; "i") then "reject"
    else null
    end;

# PENDING reviews are unsubmitted drafts and carry no verdict.
map(select(.state != "PENDING"))
| map(. + { verdict: verdict })

# Keep only verdict-bearing reviews before picking the newest one per reviewer.
# Narrowing to verdict-bearing first is what makes the grouping correct: a
# reviewer who approves and then posts an unrelated comment review must stay
# approved (the comment is not a retraction), while a reviewer who approves and
# then requests changes must not leave a phantom approval behind.
| map(select(.verdict != null))
| group_by(.user.login)
| map(max_by(.submitted_at // ""))

| map(select(.verdict == "approve"))
| map(select(.commit_id != $ENV.HEAD_SHA))
| map("\(.user.login) approved \(.commit_id)")
| .[]

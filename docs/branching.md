# Branching and approval policy

Every change reaches `main` through a pull request. No direct pushes to `main`.

The rules below are enforced by `.github/workflows/branch-policy.yml` (job
`policy`). Where a rule is mechanical, the enforcing check is named.

## 1. One branch per Paperclip issue

Name the branch `<type>/pur-<issue>-<slug>`, where `<type>` is one of `feat`,
`fix`, `chore`, `design`, `docs`, `refactor`, `test`, and `<slug>` is
lowercase words joined by hyphens.

```
fix/pur-155-canonical-host
feat/pur-160-branch-policy
```

**Never push commits for issue B onto a branch named for issue A.** This is the
exact defect that broke PR #5: `fix/pur-132-canonical-host` was approved, then
received a funnel-event emission commit and a query-form token-fallback commit
that belonged to other issues.

The PR title or body must reference the issue the branch name claims. A branch
called `fix/pur-132-...` whose PR only mentions PUR-149 is a mislabelled branch,
and the check rejects it.

*Enforced by:* `Branch name is owned by exactly one Paperclip issue`.

## 2. Approval pins a commit

PRReviewer approves **one specific SHA**, not "the PR". Once an approval exists
for a branch, that branch is frozen:

- no new commits
- no rebases
- no amends or force-pushes
- no merge of `main` into the branch

GitHub does **not** clear a review's `APPROVED` state when the head moves — the
review keeps its original `commit_id` and still reads as an approval. That is
why the PR #5 drift was invisible to everyone, including CI.

*Enforced by:* `Approved head must not advance`, which compares each reviewer's
latest verdict against the current head SHA and fails if an approval points at
an older commit.

### How an approval is recognised

Every PR in this repository is opened by the same managed account that reviews
it, and GitHub refuses self-approval (`Can not approve your own pull request`).
A native `APPROVED` review is therefore usually impossible here, so PRReviewer
records its verdict in the body of a review instead. **The first line of a
PRReviewer verdict must read:**

```
PRReviewer verdict: Approve
```

`Request changes`, `Block`, and `Reject` are the other accepted verdicts, and
markdown emphasis (`## PRReviewer verdict: **Approve**`) is fine. The check
treats both a native `APPROVED` state and this marker as an approval, so the
policy keeps working if real approvals become possible later.

Per reviewer, only the **latest verdict-bearing** review counts. A reviewer who
approves and later requests changes leaves no phantom approval; a reviewer who
approves and later posts an ordinary comment is still an approver.

## 3. Follow-up work opens a new branch and a new PR

If review turns up more work, or you simply have more to add, branch from the
approved commit (or from `main` once it merges) and open a **new** PR against
the new issue. Do not append to the approved branch.

```sh
git fetch origin
git switch -c fix/pur-161-next-thing 747d963   # the approved commit
```

## 4. Override

The escape hatch is the `approval-lock-override` label. Apply it deliberately
and **explain why in a PR comment**. It exists so the check is never a dead end.
Applying it without a stated reason is a process violation, not a workaround.

## 5. Concurrent runs must not share a checkout

Several agents work the same clone at once. Each run gets its own
`git worktree`, and the shared clone is left alone:

```sh
git -C <shared-clone> fetch origin
git -C <shared-clone> worktree add -b fix/pur-161-next-thing /tmp/wt-pur-161 origin/main
```

- Push only refs your own issue created. **Never `git push` to a ref another
  issue owns** — that is how unrelated commits land on someone else's approved
  branch.
- Never leave the shared clone checked out on another issue's feature branch.
- Remove the worktree when the run ends: `git worktree remove <path>`.

## 6. ReleaseOps merge gate

Do not merge unless **both** hold:

1. The `policy` check is green.
2. The approving review's `commit_id` equals the SHA being merged.

Check (2) by hand as well as by CI; it is the invariant the whole policy exists
to protect.

## Known gap

These checks run on every PR, but nothing yet *requires* them to pass before a
merge: GitHub branch protection is not configured, and our tooling has no
repo-admin API path to configure it (CTO is escalating that capability gap).
Until protection marks `policy` as a required check, a red policy check is a
loud signal rather than a hard block, and a PR can in principle edit its own
policy file. Treat a red `policy` check as blocking regardless.

`.github/policy/selftest.sh` guards the checks themselves — a policy check that
silently stopped working would otherwise look exactly like a compliant PR. Run
it locally with `bash .github/policy/selftest.sh`.

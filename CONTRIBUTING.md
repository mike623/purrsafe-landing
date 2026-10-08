# Contributing

Every change reaches `main` through a pull request. No direct pushes to `main`.

**Read [docs/branching.md](docs/branching.md) before you start a branch.** It is
the authoritative branching and approval policy, and most of it is enforced by
CI (`.github/workflows/branch-policy.yml`). The two rules that break releases
when ignored:

- **One branch per Paperclip issue**, named `<type>/pur-<issue>-<slug>`. Never
  put commits for one issue on a branch named for another.
- **An approval pins a SHA.** Once a PR is approved, that branch is frozen —
  no commits, no rebases, no amends. Follow-up work goes on a new branch and a
  new PR.

## Before you open a PR

```sh
npm ci
npm run check
npm run typecheck
npm test
npm run build
bash .github/policy/selftest.sh   # only if you touched .github/policy/
```

Reference the issue your branch claims in the PR title or body (`Refs PUR-160`),
or the `policy` check will reject the PR.

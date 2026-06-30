# Recipe — git workflow (branch → PR → merge commit)

How every change lands in diems: a short-lived **branch**, one or two **focused
commits**, a **pull request**, and a **merge commit** (no fast-forward). `main`
stays always-buildable, every change has a paper trail, and each branch shows up
as its own line in the git graph.

> diems is a **solo** project, so "review" means *self*-review — eyeball the diff
> on GitHub (or run `/code-review`) before merging. The branch + PR aren't
> bureaucracy: they give you a build gate and an easy rollback point.
> **Never commit straight to `main`.**
>
> We merge with a **real merge commit** (`--merge`), not a squash, so the branch's
> commits and the fork/join shape stay visible in the git tree. The cost: every
> commit you make on a branch lands on `main` verbatim — so keep branch commits
> **small and focused** (no "wip" / "fix typo" noise), since the squash that used
> to tidy them up is gone. To roll a change back, revert the **merge commit**
> (`git revert -m 1 <merge-sha>`), not an individual commit.

## Prerequisites
- **`gh` CLI authenticated** — `gh auth status` should show your account with the
  `repo` scope. `gh` opens and merges the PRs.
- **Node 22, deps installed.** `npm run build` (which type-checks **and** lints)
  must pass before a PR is merged — `main` is always buildable.
- **Never stage `data/` or `.env*`.** They hold real PII / secrets and are
  gitignored; keep it that way (`git status` before every commit).

## The loop (TL;DR)
```bash
git switch main && git pull --ff-only          # start from latest main
git switch -c feat/short-description            # 1. branch
# …edit, then…
npm run build                                   # 2. gate: type-check + lint
git add -p && git commit                        # 3. focused commit(s)
git push -u origin feat/short-description        # 4. push the branch
gh pr create --fill                             # 5. open the PR
gh pr diff                                       # 6. self-review (or /code-review)
gh pr merge --merge --delete-branch             # 7. merge commit (keeps the branch in the tree)
git switch main && git pull --ff-only           # 8. resync local main
```

---

## Step 1 — branch off an up-to-date `main`
```bash
git switch main && git pull --ff-only
git switch -c <type>/<short-kebab-description>
```
**Branch naming** — `type/short-description`, where `type` is one of:

| type | for |
|------|-----|
| `feat`     | a new feature / capability |
| `fix`      | a bug fix |
| `chore`    | tooling, deps, config, housekeeping |
| `docs`     | docs / recipes / CLAUDE.md only |
| `refactor` | behaviour-preserving cleanup |
| `data`     | a contact-research / DB data pass (note: the DB itself isn't committed) |

Examples: `feat/templates-tab`, `fix/saved-email-wrap`, `docs/git-workflow`.

## Step 2 — work in small, focused commits
- **One logical change per commit.** Don't mix unrelated edits in one PR.
- **Message:** imperative subject ≤ ~70 chars ("Add Templates tab", not "added
  templates"), a blank line, then a body that explains the **why** (the diff
  already shows the *what*).
- **Always end the message with the attribution trailer** so AI-assisted commits
  are credited:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Use `git add -p` to stage deliberately and keep commits clean.

## Step 3 — the pre-flight gate
```bash
npm run build      # type-checks + lints; must pass
git status         # confirm ONLY the files you meant — never data/ or .env*
```
If the build fails, fix it on the branch before opening the PR. `main` must never
be broken.

## Step 4 — push the branch
```bash
git push -u origin <branch>
```

## Step 5 — open the pull request
```bash
gh pr create --fill            # uses the commit(s) for title/body, or:
gh pr create --title "…" --body "What changed + why. How it was tested."
```
A good PR body: one line on **what**, a line or two on **why**, and a **Testing**
note (`npm run build` green / what you checked manually). Keep one PR = one
logical change.

## Step 6 — review (self-review for a solo repo)
- Read the diff: `gh pr diff` or open the PR on GitHub.
- For anything non-trivial, run **`/code-review`** and address what it finds.
- Confirm the checks/build are green.

## Step 7 — merge (a real merge commit) and clean up
```bash
gh pr merge --merge --delete-branch
git switch main && git pull --ff-only
```
**`--merge`** lands the PR as a **merge commit** with two parents — `main`'s tip
and the branch tip — so the branch's commits and the fork/join shape stay visible
in the git tree (instead of being flattened into one line by a squash).
`--delete-branch` removes the merged branch locally and on the remote; the **graph
bubble survives** (it's baked into the merge commit's parents) — only the branch
*label* disappears.

> **Keep branch commits tidy.** Because nothing squashes them, every branch commit
> shows on `main`. Make small, focused commits and avoid "wip" noise.
> **Reverting:** undo a whole change with `git revert -m 1 <merge-sha>` (the `-m 1`
> keeps `main`'s side as the mainline), not by reverting one branch commit.

---

## Conventions cheat-sheet
- **Branch:** `type/short-kebab-description`, off an up-to-date `main`.
- **Commit:** imperative subject, *why* in the body, `Co-Authored-By` trailer.
- **PR:** one logical change; **merge commit** (`--merge`); delete the branch after.
- **`main`:** always green (`npm run build`); **never** committed to directly.
- **Never commit** `data/` (real contact PII) or `.env*` (keys) — gitignored.

## "But it's a one-line fix…"
Still branch it. With `gh` the whole cycle is ~four commands and ten seconds, and
it keeps every change reversible and visible as its own branch in the tree. The
only thing that ever goes straight onto `main` is nothing.

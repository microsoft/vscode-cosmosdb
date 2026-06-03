---
name: backport
description: Backport changes (current branch, a PR, a branch, or specific commits/SHAs) onto a target branch (typically a release branch like `rel/*`). Use when the user says "backport this", "backport PR ...", "cherry-pick to <branch>", or asks to port commits to another branch. Handles stashing uncommitted work, branch creation, cherry-picking with conflict handling, pushing, and opening a PR.
---

# Backport Skill

Create a backport pull request that applies changes from a source (current branch, a PR, another branch, or specific commits) onto a target branch — interactively, from the local workspace. The target is typically a release branch (e.g. `rel/0.32`), but any existing branch other than `main` is allowed.

## Inputs to resolve

Before running any git commands, determine:

1. **Source** — one of:
   - **Current branch** (default if the user says "backport this" without specifying).
   - **PR number** (e.g. "backport PR #1234").
   - **Branch name**.
   - **Commit SHA(s) or range**.
2. **Target branch** — any existing branch on `origin`. Typical case is a release branch (`rel/*`). If the user did not specify, list candidates with `git branch -r --list 'origin/rel/*'` first; if none match or the user wants something else, fall back to `git branch -r` and ask. **Refuse the source's own base branch** (e.g. if the PR or current branch already targets `main`, refuse `main`; if it targets `rel/0.32`, refuse `rel/0.32`) — a backport onto the same base is a no-op. Verify the target exists on `origin` before proceeding.
3. **Squash** — only if the user explicitly says "squash". Default: no squash.

If anything is ambiguous, ask once before touching the working tree.

## Workflow

Execute these phases in order. Stop and report on any error.

### Phase A — Pre-flight & safety

1. Verify tooling: `git --version`, `gh --version`, `gh auth status`. If `gh` is missing or unauthenticated, abort with a clear message — do not continue.
2. Capture state: original branch (`git rev-parse --abbrev-ref HEAD`), `git status --porcelain`, list of unpushed commits.
3. **If source ≠ current branch** and the working tree is dirty (including untracked files):
   - Run `git stash push -u -m "backport-skill autostash <ISO-timestamp>"`.
   - Record the resulting stash ref (`git stash list -1 --format=%gd`) so it can be restored later.
4. **If source = current branch**: do not stash. Warn the user if there are uncommitted changes that won't be included, and confirm before proceeding.
5. `git fetch origin <target>`. Abort if the target branch does not exist on `origin`.

### Phase B — Resolve the commit list

- **PR source**: `gh pr view <num> --json number,title,body,headRefName,mergeCommit,commits,state`. Prefer the squash-merge commit if the PR was squash-merged; otherwise use the listed commits in order.
- **Branch source**: `git log --reverse --format=%H origin/<target>..<branch>`.
- **SHA(s) / range**: use as given (validate with `git cat-file -e <sha>`).

Show the resolved list (count + short log) to the user and confirm before continuing.

### Phase C — Create the backport branch

- Branch name: `backport/<id>-to-<target-slug>` where:
  - `<id>` is the PR number (PR source), the source branch's last segment, or `<short-sha>` (single-commit / range).
  - `<target-slug>` replaces `/` with `-` (e.g. `rel/0.32` → `rel-0.32`).
- **Collision handling** (local *or* `origin/<branch>` exists): ask the user — *overwrite* (delete local + remote, recreate) or *use a numeric suffix* (`-2`, `-3`, …). Never silently overwrite.
- `git checkout -b <name> origin/<target>`.

### Phase D — Cherry-pick

- **Squash**: `git merge --squash <source>` then `git commit -m "Backport #<n>: <original-title>"` (or a synthesized title for non-PR sources).
- **Otherwise**: `git cherry-pick <sha…>` in order.

**Conflict policy (relaxed but safe):**

1. On conflict, run `git status` and `git diff` to inspect.
2. **Auto-resolve only trivial cases**: import-order, formatting-only, additive non-overlapping hunks, or pure deletions on one side. After resolving, verify with `git diff --check` and `! grep -R '<<<<<<<' -- .` before staging.
3. **For anything ambiguous** (semantic overlap, both branches modified the same hunk meaningfully, version/lockfile bumps, generated files): stop and present the conflicting files and hunks to the user. Offer:
   - *Resolve manually & continue* — wait for the user, then `git add` + `git cherry-pick --continue`.
   - *Abort* — `git cherry-pick --abort`, delete the backport branch, restore (Phase G).
   - *Squash and retry* — only when (a) more than one commit, (b) the current run was not already squash, (c) the conflicting commit is not the last. Abort current cherry-pick, delete the branch, restart from Phase C with squash enabled.
4. Record every conflict and its resolution for the PR body.

### Phase E — Local validation (recommended)

Cherry-picks onto older release branches often produce code that compiles on the source's base but breaks on the target (different deps, removed APIs, stricter lint config). Catch this before pushing:

1. Ask the user whether to run validation. Default: **yes**. Offer to skip for speed.
2. If yes, run the repo's standard checks per [.github/copilot-instructions.md](../../copilot-instructions.md): `npm install` first (the working tree was switched from the original branch to `origin/<target>` and possibly mutated by the cherry-pick, so `node_modules` is almost certainly stale), then `npm run build`, `npm run lint`, and `npm run prettier-fix`.
3. On failure: surface the errors and stop. Treat fixes as a new round of conflict resolution — only modify what's needed; never silently pile on unrelated changes. Once green, continue.
4. If the user opts to skip, note this in the PR body so reviewers know CI is the first validation gate.

### Phase F — Push & open the PR

1. `git push -u origin <branch>` — **never** `--force` or `--force-with-lease`.
2. `gh pr create --base <target> --head <branch> --title "Backport #<n>: <original-title>" --body <body>` where `<body>` contains:
   - `Backport of #<n>` (or `Backport of <branch>` / SHA list for non-PR sources).
   - The original PR description (when applicable).
   - A **Conflicts resolved** section listing each file + a one-line description, when applicable.
3. `gh pr view --web` to open it in the browser.

### Phase G — Cleanup

- **On success**: `git checkout <originalBranch>`. If a stash was created in A.3, `git stash pop <stashRef>`. Print the new PR URL.
- **On failure or user-requested abort**: leave the backport branch and stash intact. Print the stash ref (if any) and the recovery commands (`git checkout <originalBranch> && git stash pop <stashRef>`).

## Constraints

- Refuse the source's own base branch as the target (a backport onto the same base is a no-op). Any other existing branch on `origin` is allowed, including `main`.
- Never use `--force` / `--force-with-lease`.
- Preserve original commit messages during cherry-pick.
- Do not modify files outside what is required for conflict resolution or to fix validation failures introduced by the cherry-pick.
- Never silently overwrite an existing local or remote branch.
- Never auto-resolve ambiguous conflicts; always ask.
- Never restore the autostash on failure — leave it for the user to inspect.

## Reporting

When done, summarize:

- Source, target, backport branch name, commits cherry-picked.
- Any conflicts encountered and how they were resolved.
- Whether local validation ran and its result (or that the user opted to skip).
- The new PR URL.
- Whether the original branch and stash were restored.

## Running as the GitHub cloud agent

When this skill runs inside the GitHub Copilot cloud agent (e.g. invoked by `@copilot` on a merged PR or assigned to a backport issue), the environment differs from a local VS Code workspace. Adjust the workflow as follows:

- **No interactive prompts.** You cannot pause to ask the user. Resolve everything from the request body and repository state up front; if a required input is missing or ambiguous (target branch, source PR), stop and report rather than guess.
- **Branch naming**: use `copilot/backport-<id>-to-<target-slug>` instead of `backport/...`. The cloud agent can only push branches starting with `copilot/`.
- **Skip Phase A.3 stash logic** — the cloud agent runs in a fresh ephemeral checkout; there is no user working tree to preserve.
- **Skip Phase E (local validation)** — the cloud agent's GitHub Actions environment runs CI as the validation gate; do not run `npm install` / build / lint to save time and avoid burning Actions minutes.
- **Skip Phase F's `gh pr create`.** The cloud agent platform opens the PR for the task automatically. Use `gh pr edit` to set the base branch, title, body, and (when needed) `gh pr ready --undo` to mark it draft.
- **Conflict policy** is stricter: still auto-resolve only trivial cases. For ambiguous conflicts, do **not** invent a resolution — commit the conflict markers as-is on the `copilot/...` branch (`git commit --no-verify -m "WIP: backport conflicts in <files>"`), list each unresolved file in the PR body, and mark the PR as **draft**.
- **Skip Phase G's stash restore and original-branch checkout** — there's nothing local to restore.

All other constraints (no `--force`, refuse the source's own base, preserve commit messages, never silently overwrite existing branches) apply unchanged.

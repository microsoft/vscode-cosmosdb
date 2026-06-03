---
name: backport
description: Backport changes (current branch, a PR, a branch, or specific commits/SHAs) onto a target branch (typically a release branch like `rel/*`). Use when the user says "backport this", "backport PR ...", "cherry-pick to <branch>", or asks to port commits to another branch. Handles stashing uncommitted work, branch creation, cherry-picking with conflict handling, pushing, and opening a PR.
---

# Backport Skill

Create a backport pull request that applies changes from a source (current branch, a PR, another branch, or specific commits) onto a target branch — interactively, from the local workspace. The target is typically a release branch (e.g. `rel/0.32`), but any existing branch is allowed except the source's own base branch (a backport onto the same base is a no-op).

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

- **PR source**: `gh pr view <num> --json number,title,body,headRefName,baseRefName,mergeCommit,commits,state`. If the command fails (non-zero exit, PR not found, or insufficient permissions), abort with a clear error message showing the PR number and the `gh` error output. Then branch on `state`:
  - `MERGED`: prefer the squash-merge commit if the PR was squash-merged; otherwise use the listed commits in order.
  - `OPEN`: warn that backporting an unmerged PR may include incomplete or intermediate work, and confirm with the user before proceeding. Use the listed commits in order.
  - `CLOSED` (not merged): legitimate but unusual. Warn the user that the PR was closed without merging (the work may have been abandoned, superseded, or rewritten elsewhere) and confirm before proceeding. Use the listed commits in order, or offer squash-and-reapply if the user prefers a single commit.
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

> **Cloud-agent override:** when running inside the GitHub Copilot cloud agent (see "Running as the GitHub cloud agent" below), use the stricter policy: auto-resolve only trivial cases per step 2; for anything ambiguous, **do not** invent a resolution — commit the conflict markers as a `WIP:` commit and mark the PR as draft. Skip steps 3 and 4 (no interactive prompts, no squash-and-retry).

1. On conflict, run `git status` and `git diff` to inspect.
2. **Auto-resolve only trivial cases**:
   - *Import-order*: only the order of `import` / `require` statements differs; identifiers are identical.
   - *Formatting-only*: whitespace, trailing comma, or semicolon changes where no identifiers, literals, or control flow differ between sides.
   - *Additive non-overlapping hunks*: one side adds lines while the other side is unchanged in that region.
   - *Pure deletions on one side*: one side deletes a block, the other leaves it untouched, and the deleted block is not referenced by code added on either side.
   After resolving, verify with `git diff --check` and `! grep -R '<<<<<<<' -- .` before staging.
3. **For anything ambiguous** (semantic overlap, both branches modified the same hunk meaningfully, version/lockfile bumps, generated files): stop and present the conflicting files and hunks to the user. Offer:
   - *Resolve manually & continue* — wait for the user, then `git add` + `git cherry-pick --continue`.
   - *Abort* — `git cherry-pick --abort`, delete the backport branch, restore (Phase G).
   - *Squash and retry* — only when (a) more than one commit, (b) the current run was not already squash, (c) the conflicting commit is not the last. Abort current cherry-pick, delete the branch, restart from Phase C with squash enabled.
4. Record every conflict and its resolution for the PR body.

### Phase E — Local validation (recommended)

Cherry-picks onto older release branches often produce code that compiles on the source's base but breaks on the target (different deps, removed APIs, stricter lint config). Catch this before pushing:

1. Ask the user whether to run validation. Default: **yes**. Offer to skip for speed.
2. If yes, run the repo's standard checks following [.github/copilot-instructions.md](../../copilot-instructions.md). Because the working tree was switched from the original branch to `origin/<target>` and may have been mutated by the cherry-pick, `node_modules` is almost certainly stale — always start with `npm install`. Then run, in this order: `npm run build`, `npm run l10n`, `npm run prettier-fix`, `npm run lint`. Always run `npm run l10n` regardless of whether the cherry-pick obviously touches user-facing strings: dependency bumps can alter embedded error messages, and the target release branch may carry pre-existing l10n drift that the CI `l10n:check` will fail on. If the bundle changes, commit the regenerated bundle as a separate `chore: regenerate l10n bundle` commit on the backport branch before the Phase F push.
3. **Pull translations from the source's base branch** — only when the user opted into validation in step 1, the cherry-pick changed `l10n/bundle.l10n.json` (English bundle), **and** the source PR is merged. After the original PR merged, a localization bot typically commits translated strings to the source's base (e.g. `main`) — those translations apply equally to the backport and should not be re-translated by hand. **Pull only the affected keys**, never wholesale-replace language files: the source base may have other strings the target branch must not gain. Procedure:
   - Determine the set of changed keys in the English bundle on the backport branch versus the target. Compare keys (top-level JSON object keys) between `git show origin/<target>:l10n/bundle.l10n.json` and the current `l10n/bundle.l10n.json`. Record:
     - **Added keys** — present in current, absent in target.
     - **Modified keys** — present in both but with different values (rare, but possible if the English text changed).
     - Removed keys are irrelevant for translation pulling (already gone from the English bundle, will be dropped from language files by `npm run l10n`).
   - Do the same comparison for `package.nls.json` (its translations live in `package.nls.<lang>.json`).
   - For each language file (`l10n/bundle.l10n.<lang>.json` and `package.nls.<lang>.json`, every `<lang>` present in the repo), read the source-base version with `git show origin/<source-base>:<file>`, then for each added/modified key copy that key's translated value into the local language file. Leave all other keys in the local file untouched. **Preserve the existing line endings and key order** of the local file: translation pipelines often write CRLF and use a non-obvious collation order, and re-sorting or re-serializing produces a massive cosmetic diff that reviewers will reject. Insert each new key adjacent to the nearest preceding key (in source-base order) that already exists locally; serialize with `JSON.stringify(obj, null, 2)`, then convert `\n` back to `\r\n` if the local file used CRLF. If the source-base version is missing a key (translation bot hasn't run yet), skip it — `npm run l10n` will leave the English fallback.
   - Re-run `npm run l10n` to refresh the English bundle (the language files are not modified by this script in current builds; it only normalizes `l10n/bundle.l10n.json`).
   - Stage only the language files that actually changed (`git add l10n/bundle.l10n.*.json package.nls.*.json`) and commit as `chore: pull updated translations from <source-base>`. Do **not** stage `l10n/bundle.l10n.json` or `package.nls.json` here — those belong to the earlier `chore: regenerate l10n bundle` commit.
   - If the source PR is **not** merged (open or closed without merging), skip this step — translations don't exist yet.
4. On failure: surface the errors and stop. Treat fixes as a new round of conflict resolution — only modify what's needed; never silently pile on unrelated changes. Once green, continue.
5. If the user opts to skip, note this in the PR body so reviewers know CI is the first validation gate.

### Phase F — Push & open the PR

1. `git push -u origin <branch>` — **never** `--force` or `--force-with-lease`. If the push fails, surface the full `git` error. If it is a permission or branch-protection error (e.g. protected-branch hook, missing write access), advise the user to check repository settings; do not retry with force flags. Proceed to Phase G failure cleanup.
2. `gh pr create --base <target> --head <branch> --title "[<target>] <original-title>" --body <body>` where `<body>` contains:
   - The PR title **must** start with the target branch in square brackets, e.g. `[rel/0.34] Fix tree refresh race`. Use the exact target branch name (including any `rel/` prefix) and keep the rest of the title identical to the original PR title (or first commit subject for non-PR sources).
   - `Backport of #<n>` (or `Backport of <branch>` / SHA list for non-PR sources).
   - The original PR description (when applicable).
   - A **Conflicts resolved** section listing each file + a one-line description, when applicable.
3. `gh pr view --web` to open it in the browser.

### Phase G — Cleanup

- **On success**: `git checkout <originalBranch>`. If a stash was created in A.3, `git stash pop <stashRef>`. Print the new PR URL.
- **On failure or user-requested abort**: leave the backport branch and stash intact. Print the stash ref (if any) and the recovery commands (`git checkout <originalBranch> && git stash pop <stashRef>`).

## Constraints

- Refuse the source's own base branch as the target (a backport onto the same base is a no-op). Any other existing branch on `origin` is allowed. `main` is allowed **only when** it is not the source's base; if the source already targets `main`, refuse `main` per the rule above.
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
- **Apply the Phase D cloud-agent override** described above (commit conflict markers as `WIP:` and mark the PR draft instead of asking, aborting, or squash-and-retry).
- **Skip Phase E (local validation)** — the cloud agent's GitHub Actions environment runs CI as the validation gate; do not run `npm install` / build / lint to save time and avoid burning Actions minutes.
- **Skip Phase F's `gh pr create`.** The cloud agent platform opens the PR for the task automatically. Use `gh pr edit` to set the base branch, title, and body. The title **must** be prefixed with the target branch in square brackets — e.g. `[rel/0.34] <original-title>`. When conflicts remain unresolved, mark the PR as draft (the platform may open it ready by default; use `gh pr ready --undo` if available, otherwise note the WIP state explicitly in the PR body).
- **Skip Phase G's stash restore and original-branch checkout** — there's nothing local to restore.

All other constraints (no `--force`, refuse the source's own base, preserve commit messages, never silently overwrite existing branches) apply unchanged.

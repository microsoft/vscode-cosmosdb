---
name: update-packages
description: Update npm dependencies within existing semver ranges through a user-selected registry, then write canonical npmjs.org tarballs and integrities to package-lock.json. Use when the user says "update packages", "update dependencies", "bump deps", "re-apply a dependabot bump", or asks to update package-lock.json. Supports standard npm resolution or an optional npmjs latest/pre-release guard, validation, commit, and optionally a PR.
---

# Update Packages Skill

Update `package-lock.json` with standard npm resolution against a registry chosen by the user. Never modify
a root or workspace `package.json` unless the user explicitly requests range changes.

The updater uses the selected registry to resolve versions, then replaces metadata for changed registry
packages with the canonical npmjs `dist.tarball` and `dist.integrity`. A tarball URL and integrity must
always come from the same registry.

## Ask before running

Always ask which update mode the user wants:

1. **Standard npm update (default)** — trust the selected registry's normal npm resolution and dist-tag
   policy.
2. **Guarded by npmjs tags** — run the same update, but additionally apply npmjs.org's policy: reject and
   roll back if a changed package is a pre-release or exceeds the `latest` dist-tag published specifically
   by npmjs.org.

When presenting these choices, explicitly say that guarded mode consults **npmjs.org tags regardless of
which registry resolves the update**. It is useful when npmjs promotion policy is an intended safety gate,
but it is not always appropriate: a private feed, staged rollout, beta channel, or another authoritative
registry may intentionally differ from npmjs. Do not describe guarded mode as generally safer or recommend
it by default; let the user decide whether npmjs tags should constrain this update.

Then ask which registry should resolve versions:

1. **Repository Azure Pipelines feed** — use the registry from `.azure-pipelines/.npmrc`.
2. **Common Microsoft proxy** — `https://packagefeedproxy.microsoft.io/npm/` (no authentication).
3. **PowerBI Azure Artifacts feed** —
   `https://powerbi.pkgs.visualstudio.com/_packaging/PowerBIClients/npm/registry/`.
4. **Custom feed** — supplied by the user.
5. **npmjs directly** — `https://registry.npmjs.org/`.

Do not assume all CI jobs use one registry. In this repository GitHub Actions installs from npmjs, while
Azure Pipelines authenticates the registry configured in `.azure-pipelines/.npmrc`.

Also resolve:

- **Scope** — named packages or every package npm can update within its declared range.
- **Base branch** — current branch unless the user names another base.
- **Deliverable** — commit only, or commit plus push/PR.

## Authentication

The common Microsoft proxy and npmjs require no authentication. For Azure Artifacts, authenticate before
running the updater:

```powershell
npx vsts-npm-auth -config <npmrc-containing-the-selected-feed> -f
```

The command is interactive and Windows-only. Its source `.npmrc` must name the selected feed.

## Updater

Standard mode:

```powershell
$env:FEED_REGISTRY = '<registry>'
node .github/skills/update-packages/scripts/update-lockfile.mjs [package ...]
```

Guarded-by-npmjs-tags mode:

```powershell
$env:FEED_REGISTRY = '<registry>'
node .github/skills/update-packages/scripts/update-lockfile.mjs --guard-npm-latest [package ...]
```

With no package arguments, npm updates the whole lockfile within existing declared ranges. With package
arguments, npm scopes the update to those names.

The helper:

1. Snapshots the exact `package-lock.json` bytes.
2. Runs:
   ```text
   npm update [package ...] --package-lock-only --registry <selected-registry>
   ```
3. Removes npm 12 metadata churn by restoring entries whose versions did not change.
4. Fetches npmjs metadata for every changed HTTP registry entry and writes both canonical `resolved` and
   `integrity`.
5. In guarded mode, checks each changed version against the `latest` tag from npmjs.org and rejects
   pre-releases. This is npmjs-specific policy, not validation of the selected feed's own tags.
6. Restores the original lockfile and fails if npm, metadata retrieval, canonicalization, or guarded
   validation fails.
7. Prints every changed `current -> target` version.

The helper never reads `node_modules`, so no preparatory install is needed. Registry/network errors are
fatal after limited retries; they are never interpreted as successful safety checks.

Environment overrides:

```text
FEED_REGISTRY  resolution registry; defaults to the common Microsoft proxy
NPM_REGISTRY   canonical metadata registry; defaults to https://registry.npmjs.org/
CONCURRENCY    parallel metadata requests; defaults to 8
```

## Workflow

Stop on any nonzero exit code.

### 1. Pre-flight

1. Require a clean `git status --porcelain`. If dirty, ask before mixing dependency changes with it.
2. Create `dev/<user>/update-packages`, using a requested base branch when supplied.
3. Ask for the mode, explicitly explaining the npmjs-specific guarded semantics, then ask for the registry,
   scope, and deliverable.
4. Authenticate the registry when required.

### 2. Update

Run `update-lockfile.mjs` in the selected mode and scope. Do not replace it with `npm install <pkg>@<ver>
--no-save`; npm 12 does not persist that as the required lockfile-only update.

If the helper reports no changed entries, report that npm found nothing eligible and stop.

### 3. Verify

1. `git diff --name-only -- '**/package.json' 'package.json'` must be empty.
2. `git diff --name-only` must contain only the intended `package-lock.json`.
3. Every added `resolved` URL for a changed registry package must use `https://registry.npmjs.org/`.
4. Review the reported and diffed version changes for unexpected scope expansion.

Pre-existing non-npmjs entries outside the update remain untouched. Private, git, file, and workspace
dependencies must not be rewritten as npmjs packages.

### 4. Reify and validate

Sync `node_modules` incrementally while preserving the intended lockfile bytes:

```powershell
node .github/skills/update-packages/scripts/sync-tree.mjs
```

Never delete `node_modules` and never run `npm ci` for local validation. Then run:

```powershell
npm run prettier-fix
npm run lint
npm run build
```

Verify every exit code and re-check that formatting/linting did not create changes outside the lockfile.

### 5. Commit and optional PR

Stage only `package-lock.json`. Use a Conventional Commit and the required trailer:

```text
build(deps): bump <packages>

<package>: <current> -> <target>

Versions were resolved from <selected registry> and use canonical npmjs resolved/integrity metadata.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Push and open a PR only when requested. Never force-push.

## Invariants

- Never modify any `package.json` for a lockfile-only update.
- Never change only `resolved`; update its matching `integrity` from the same npmjs metadata.
- Never silently ignore registry, metadata, or guarded-validation errors.
- Never trust the machine's default registry; pass the selected registry explicitly.
- Never rewrite unchanged non-npmjs, private, git, file, or workspace entries.
- Never run `npm ci` or delete `node_modules` as preparation or validation.

## Report

Report the selected mode, registry and scope, applied `current -> target` changes, failures/skips, validation
result, branch name, and PR URL when created.

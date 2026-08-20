---
name: update-packages
description: Update npm dependencies to safe, quarantine-cleared versions using the Microsoft package feed, writing canonical npmjs.org tarballs to package-lock.json. Use when the user says "update packages", "update dependencies", "bump deps", "re-apply a dependabot bump", or asks to move dependencies to newer versions that will pass internal CI. Handles version selection (feed availability + npmjs `latest` dist-tag guard), lockfile-only updates within existing semver ranges, validation, commit, and optionally a PR.
---

# Update Packages Skill

Bump npm dependencies to the newest version that is **safe on both sides**: available on the internal
Microsoft package feed (so CI, which installs from that feed, can resolve it) **and** not ahead of the
version npmjs.org has promoted to its `latest` dist-tag (so we never jump to a pre-release/beta that the
feed mislabels). The lockfile is updated **within the existing semver ranges only** — `package.json` is
never touched — and every `resolved`/`integrity` field is written from the **canonical npmjs.org tarball**.

## Why this is not just `npm update`

This skill *is* `npm update` at heart — it lets npm resolve every declared range — but with two extra
constraints that a naive `npm update` against npmjs.org would violate:

1. **The Microsoft feed quarantines newly published versions for ~7 days.** A version that exists on
   npmjs may not yet be installable from the feed, so CI (which uses the feed) would fail. We must only
   pick versions the feed actually serves. This is handled automatically by running `npm outdated`
   **against the feed** — its `wanted` can then never exceed what the feed serves.
2. **The Microsoft feed ignores npm dist-tags.** Its notion of "latest" is simply the highest version
   number published, so it can point at a version that npmjs still keeps off `latest` (a beta / `next`
   release). We must not jump to such a version, so we cap every target at npmjs' `latest` dist-tag.

Because the two registries can also disagree on the **tarball bytes** (different `sha512` integrity for
the "same" version), the lockfile's `resolved`/`integrity` must come from **one** registry. We use
npmjs.org for the bytes (canonical, publicly reproducible) and use the feed only to *discover and gate*
versions.

When the user selects **no feed**, there is no quarantine to respect, so the skill deliberately degrades to
exactly `npm update` (within ranges) against npmjs — the two constraints above simply do not apply.

## Version-selection rule (the core)

Resolution is delegated to npm so the real semver ranges are honored — direct deps' `package.json` ranges
**and** transitive deps' parent ranges — exactly like `npm update`:

1. Run `npm outdated --all --json` **against the Microsoft feed**. For each install location npm reports
   `wanted` (where `npm update` would move it) already limited to versions the feed serves.
2. For a package's **hoisted (top-level)** install, the target is the **minimum `wanted` across every
   dependent that shares that install** — one hoisted copy must satisfy them all, so the most constrained
   dependent wins. This is what prevents false bumps (e.g. an aliased `typescript` where some dependents
   allow a newer major but others pin the current one).
3. The **current** version is read from `package-lock.json` (the committed source of truth), so the result
   is correct even if `node_modules` has drifted.
4. Cap the target at the package's **`latest` dist-tag on npmjs.org**. If the feed's `wanted` exceeds
   npmjs' `latest`, or is itself a pre-release, do **not** auto-bump — flag it for manual review.
5. **Feed-availability check (the reverse hazard).** Steps 1–4 only surface versions the feed serves
   *newer* than the lockfile. They cannot see a lockfile pinned to a version the feed does **not** serve
   — e.g. a bump installed straight from npmjs before it cleared the feed's quarantine — which CI
   restoring from the feed would fail to resolve. For every **direct** dependency, check the pinned
   lockfile version against the feed; if it is missing, propose the **highest feed version that satisfies
   the declared range and is not ahead of npmjs' `latest`** (a downgrade). The `latest` cap matters
   because the feed ignores npm dist-tags, so its top in-range version may be a beta npmjs never promoted.
   If no such feed version exists, flag for review.

The bundled helper implements all of this and only reads state — it mutates nothing:

```
node .github/skills/update-packages/scripts/select-targets.mjs [pkg ...]
```

- **no arguments** → every outdated top-level package.
- **with names** → restrict the report to those packages.

It prints a table plus a machine-readable JSON block between `BEGIN_JSON` / `END_JSON` listing
`{ name, current, target }` for each package that should change — this includes both feed-newer **upgrades**
and feed-availability **downgrades** (apply is identical: install `target` from npmjs) — and separately
lists packages flagged for review (feed ahead of npmjs `latest`, a pre-release, or a lockfile version the
feed cannot serve with no in-range alternative). Version metadata (each package's versions and its `latest`
dist-tag) is read with a single HTTPS `fetch` of the abbreviated packument per package+registry — cached
and shared across both passes — rather than per-package `npm view` subprocesses, so the selector stays fast
even on a large tree. Registries can be overridden with the `FEED_REGISTRY` / `NPM_REGISTRY` environment
variables (defaults: the no-auth Microsoft proxy `https://packagefeedproxy.microsoft.io/npm/` and
`https://registry.npmjs.org/`); `CONCURRENCY` tunes the parallel packument fetches.

> **Prerequisite:** the selector reads each package's **current** version from `package-lock.json` (not
> from `node_modules`), so a clean, in-sync checkout does **not** need reinstalling. But `npm outdated`
> derives its report from `node_modules`, so the tree does affect **which rows appear**: if `node_modules`
> has drifted **ahead** of the lockfile (installed version ≥ `wanted`), npm emits **no row** for that
> package and the selector silently drops it — in the worst case returning an empty "nothing to update"
> while real bumps are masked. The selector detects this by comparing the lockfile against npm's own record
> of the installed tree (`node_modules/.package-lock.json`) and prints a **DRIFT** warning to stderr. If you
> see it, sync the tree first with an **incremental** `npm install` (never `npm ci`) and re-run — the
> bundled `scripts/sync-tree.mjs` does this safely (see Phase A step 3). A merely **missing** row for a
> behind/absent tree is harmless; an **ahead** tree is not.

## Inputs to resolve

Before running anything, determine:

1. **Feed** — which registry the update should be gated against (this is the registry CI restores from, so
   targets must be resolvable there). Ask the user and offer these options:
   - **Common Microsoft proxy** *(default, no auth)* — `https://packagefeedproxy.microsoft.io/npm/`. Use
     this when unsure; it is the no-auth proxy the selector already defaults to.
   - **PowerBI Azure Artifacts feed** *(requires auth)* —
     `https://powerbi.pkgs.visualstudio.com/_packaging/PowerBIClients/npm/registry/`. Acquire a token
     first (Phase A) before any feed query.
   - **A custom feed** — the user supplies the registry URL. It may also require auth (same token step as
     PowerBI).
   - **No feed** — skip feed gating entirely and update straight against npmjs with plain `npm update`
     (see the no-feed path in Phase B). Choose this when the project has no internal feed / quarantine.

   Pass the chosen registry to the selector via `FEED_REGISTRY=<url>`; the npmjs `latest` guard always uses
   `NPM_REGISTRY` (npmjs). For an **authenticated** feed, run the token step in Phase A first: the selector's
   `npm outdated` pass and its direct-dep feed-availability (downgrade) pass both authenticate using the
   token `vsts-npm-auth` wrote to `.npmrc` (Bearer `_authToken`, or Basic `username`+`_password`).
2. **Scope** — default is *every outdated top-level package*. If the user named specific packages (e.g.
   "update fast-uri and js-yaml", or "re-apply the dependabot bumps for X, Y"), restrict to that list.
   Named packages may be transitive.
3. **Base branch** — where the update should land. Default: a new branch off the current branch. If the
   user says "on top of <branch>/<PR>", check that branch out first and branch from it.
4. **Deliverable** — commit only, or commit + push + open a PR. Ask if unclear (default: commit, then
   ask before pushing).

If anything is ambiguous, ask once before mutating the working tree.

## Workflow

Execute in order. Stop and report on any error (verify every command exits `0`).

### Phase A — Pre-flight

1. `git status --porcelain` — the working tree must be clean before starting. If dirty, ask whether to
   proceed (the update will be mixed into their changes) or stop.
2. Create the working branch: `git checkout -b dev/<user>/update-packages` (or from the requested base
   branch first). Use the repository's branch-naming convention (`dev/<username>/...`).
3. **Do not reinstall to "prepare".** The selector reads each package's `current` version from
   `package-lock.json`, not from `node_modules`, so a clean checkout needs no reinstall — and `npm ci` is
   **never** an acceptable prep or validation step here (see the warning in Phase E: it wipes `node_modules`,
   which is the slowest step in the workflow and, in a live dev environment, fails outright). Only if
   `node_modules` is actually **missing** should you populate it, and then with an **incremental**
   `npm install` (never `npm ci`).
   - **Drift exception (do not skip).** There is one case where the tree *does* matter: if `node_modules`
     has drifted **ahead** of the lockfile (e.g. leftovers from earlier experiments), `npm outdated` sees
     `installed ≥ wanted` and reports **no row**, so the selector silently returns an incomplete — possibly
     empty — list. The selector detects this and prints a **DRIFT** warning to stderr. When you see it (or
     the selector reports "0 to bump" on a repo you expect to have updates), **sync the tree first**, then
     re-run the selector. Sync with the bundled helper, which is safe against the `EALLOWREMOTE` trap below:
     ```
     node .github/skills/update-packages/scripts/sync-tree.mjs
     ```
     It temp-patches any pre-existing feed `resolved` URL to npmjs for the duration of an **incremental**
     `npm install`, then restores the lockfile bytes verbatim (so the committed diff is untouched). Never
     `npm ci`.
   - **`EALLOWREMOTE` (why the plain `npm install` can abort).** If the user's npm config sets
     `replace-registry-host=npmjs`, npm **refuses** to download any `resolved` that points at a feed host
     ("EALLOWREMOTE"). A lockfile may legitimately carry such a pre-existing feed URL (e.g.
     `@azure/arm-features`) that we must **not** rewrite in the commit. When that package is already
     installed, a plain `npm install` never fetches it and succeeds; when it is **missing** (fresh/wiped
     tree), it aborts. `sync-tree.mjs` is the fix — use it instead of a bare `npm install` whenever the tree
     needs syncing.
4. **Authenticate the feed if it needs it.** The default common proxy
   (`https://packagefeedproxy.microsoft.io/npm/`) needs **no** auth. The PowerBI feed and most custom
   Azure Artifacts feeds **do** — acquire a token before any feed query:
   ```
   npx vsts-npm-auth -config .npmrc -f
   ```
   - `-config` (`-C`) points at the **source** `.npmrc` that lists the feed registry to authenticate
     (the project `.npmrc`); the token is written to the **target** config, which defaults to your user
     `%USERPROFILE%/.npmrc` (override with `-T`). `-f` (`-F`) forces a refresh even if a token exists.
   - This is **interactive and blocks** until you complete the PIN / domain sign-in — treat it as a
     long-running foreground step and wait for it, do **not** pass `-N` (non-interactive). The tool is
     **Windows-only**.
   - Skip this step for the no-auth common proxy and for the no-feed path.
5. Do **not** rely on the machine's configured registry — always pass `--registry` (the selector does this
   for you via `FEED_REGISTRY`) so the result is deterministic regardless of `.npmrc` defaults.

### Phase B — Select targets

> **No-feed path.** If the user chose **No feed**, skip the selector and Phase C entirely: run
> `npm update --package-lock-only` (or scoped: `npm update --package-lock-only <pkg> ...`). This resolves
> every declared range against npmjs and rewrites **only** `package-lock.json` with canonical npmjs tarballs,
> without touching `package.json` and without editing its declared ranges — so no `resolved`-rewrite step is
> needed. Do **not** use `--no-save` (on npm ≥ 12 it silently no-ops the lockfile — see Phase C). Then
> continue at **Phase D** (verify) and **Phase E** (build). The rest of Phase B/C below applies only when a
> feed was chosen.

1. Run the helper for the resolved scope (pass the chosen feed via `FEED_REGISTRY` when it is not the
   default proxy, and authenticate it first per Phase A if it needs a token):
   - whole tree: `node .github/skills/update-packages/scripts/select-targets.mjs`
   - a subset: `node .github/skills/update-packages/scripts/select-targets.mjs fast-uri js-yaml ...`
   - a non-default feed: `FEED_REGISTRY=<url> node .github/skills/update-packages/scripts/select-targets.mjs`
2. Read the printed table and the `BEGIN_JSON … END_JSON` list. Show the user the proposed bumps
   (package: current → target) and confirm before applying. If the list is empty, report "nothing to
   update" and stop.
3. Report any package the helper flagged **for review** (`feed ahead of npmjs latest …` or
   `wanted is a pre-release …`): do not auto-bump these — they need a human decision. Aliased packages
   (e.g. a `typescript` installed via `npm:@scope/pkg@range`) also warrant a manual look before applying.

### Phase C — Apply (lockfile-only, npmjs tarballs)

Get the lockfile to the exact target versions with **canonical npmjs.org** `resolved`/`integrity`, without
editing `package.json`.

> **npm-version caveat (why not `npm install … --no-save`).** On **npm ≥ 12**, `npm install <pkg>@<ver>
> --no-save` does **not** write `package-lock.json` at all — it only reifies `node_modules`, so the lockfile
> is silently left unchanged (verified on npm 12.0.2 for both direct and transitive deps). And plain
> `npm install --package-lock-only` (without `--no-save`) rewrites the declared **ranges** in `package.json`.
> Neither can do a lockfile-only, `package.json`-untouched bump. Use `npm update --package-lock-only`
> instead: it moves the **locked** versions within the existing ranges and never edits `package.json` or its
> range mirror in the lockfile's root entry (so lock/manifest stay in sync for CI's `npm ci`).

1. **Update the locked versions, lockfile-only, run against the FEED.** Pass exactly the package **names**
   from the selector's `BEGIN_JSON` list (versions come from the ranges; the flagged-for-review packages are
   excluded, so `npm update` cannot pull a pre-release or a feed-ahead-of-npmjs version):
   ```
   npm update <name> [<name> ...] --package-lock-only --registry <FEED>
   ```
   Running against the feed makes its ~7-day quarantine cap every version at the feed-served target — this
   reproduces the selector's choice and prevents overshoot to a newer npmjs `latest` the feed cannot serve
   yet (e.g. it lands `@fluentui/react-icons` on the feed's `2.0.336`, not npmjs' `2.0.337`). Do **not** pass
   `--no-save` (no-ops the lockfile on npm ≥ 12) and do **not** run a bare `npm install …@target` (overshoots
   and needlessly reifies `node_modules`).

2. **Rewrite the feed tarball hosts to canonical npmjs.** Step 1 writes the feed's host into every changed
   `resolved`/`integrity` (e.g. `*.pkgs.visualstudio.com`). Rewrite only the entries this run introduced to
   the npmjs.org tarball + npmjs `dist.integrity`, leaving any pre-existing feed URL untouched:
   ```
   node .github/skills/update-packages/scripts/rewrite-resolved-to-npmjs.mjs
   ```
   The helper diffs the working lockfile against `HEAD:package-lock.json` (so it skips pre-existing feed
   URLs), fetches each changed package's npmjs `dist.tarball`/`dist.integrity`, and writes them in place. It
   only touches `resolved`/`integrity` values, preserving key order so the diff stays minimal.

3. If a transitive target is not reachable within the current tree, `npm update` simply won't move it — the
   selector's row then won't appear in the lockfile diff. Exclude that package and report it; do not force it.

> **Ordering rule:** the `npm update` in step 1 is the last *version-resolving* npm command. The step-2
> rewrite is a targeted hand-correction of `resolved`/`integrity` performed **after** it. The only npm
> command allowed afterwards is the Phase E **reify-only** `npm install` (lockfile-authoritative, no range
> given, so it cannot re-resolve versions) — and Phase E re-verifies the diff and re-runs this helper if that
> install disturbs any `resolved`. Never run another `npm update`/ranged `npm install` after step 2.

### Phase D — Verify the lockfile

1. **Versions:** confirm each bumped package shows the target version:
   ```
   node -e "const l=require('./package-lock.json');for(const [k,v] of Object.entries(l.packages)){const b=k.split('node_modules/').pop();if(process.argv.slice(1).includes(b))console.log(b,v.version,v.resolved)}" <pkg> <pkg> ...
   ```
2. **Resolved host:** every changed `resolved` URL must point at `https://registry.npmjs.org/`. Confirm no
   Microsoft-feed host leaked into the **added** lines of the diff:
   ```
   git diff package-lock.json | Select-String '^\+' | Select-String 'resolved' | Select-String -NotMatch 'registry.npmjs.org'
   ```
   That command must return nothing. (A pre-existing feed URL elsewhere in the lockfile that your diff did
   **not** touch is out of scope — do not rewrite it, because its `integrity` was computed from the feed
   tarball and changing only the host would break `npm ci`.)
3. **No manifest touched (git-state driven, workspace-aware).** This is an npm **workspaces monorepo**
   (`workspaces` in the root `package.json`), so there are **multiple** `package.json` files (root +
   `packages/*`) but a **single** root `package-lock.json`. Don't check only the root manifest — read the
   actual git state and assert that **no** `package.json` anywhere changed:
   ```
   git diff --name-only -- '**/package.json' 'package.json'
   ```
   That must return nothing. (`npm update --package-lock-only` should never edit a manifest, but a workspace
   `package.json` slipping into the diff means something re-resolved ranges — investigate, don't commit it.)
4. **Diff scope (git-state driven).** Confirm the full changed set is exactly the intended lockfile(s):
   ```
   git diff --name-only
   ```
   For npm workspaces this must be exactly `package-lock.json`. If the repo instead has **several**
   independent lockfiles (nested projects each with their own `package-lock.json`, not npm workspaces), the
   set is those lockfiles — and Phase C step 1 / the rewrite helper must be run **per lockfile** (`cd` into
   each project), since each has its own `resolved`/`integrity` entries. Anything else in the diff is out of
   scope; back it out.

### Phase E — Validate the build

A dependency bump can change the shape of installed type definitions, so verify the project still
type-checks and builds.

> **Never run `npm ci` and never delete `node_modules` to "validate".** The lockfile is already correct by
> construction — the versions came from `npm update` within ranges, and every rewritten `integrity` came
> from npmjs' authoritative `dist` metadata. A full reinstall proves nothing extra, is the slowest step in
> the workflow, and in a live dev environment **fails**: the IDE keeps native service binaries loaded
> (`oxfmt`, `oxlint`, `tsserver`, …), so wiping `node_modules` hits `EPERM` unlinking exactly those files;
> and once `node_modules` is gone, a pre-existing feed `resolved` URL can abort the reinstall with
> `EALLOWREMOTE`. Those failures are environment artifacts, not lockfile problems — don't chase them.

1. **Sync `node_modules` to the corrected lockfile incrementally** (so the build type-checks against the new
   versions, not the old ones). `npm update --package-lock-only` in Phase C did **not** touch `node_modules`,
   so reify just the changed packages — without wiping anything:
   ```
   npm install --registry https://registry.npmjs.org/ --no-audit --no-fund
   ```
   This fetches only the bumped packages (all npmjs URLs) and leaves unchanged native binaries and the
   pre-existing feed-URL package in place (both already installed), so it avoids the `EPERM`/`EALLOWREMOTE`
   traps above. Afterwards, re-check the lockfile diff is still limited to your intended changes (if `npm
   install` re-touched any `resolved` back to a feed host, re-run the Phase C step-2 helper — it is
   idempotent).
   - **If this `npm install` aborts with `EALLOWREMOTE`** (the pre-existing feed-URL package is *not*
     already installed — e.g. the tree was wiped), use the bundled helper instead, which temp-patches that
     URL to npmjs for the install and then restores the lockfile bytes verbatim:
     ```
     node .github/skills/update-packages/scripts/sync-tree.mjs
     ```
     It performs the same incremental install, so the diff-recheck note above still applies.
2. **Build:**
   ```
   npm run build
   ```
   Confirm it exits `0`.

Do **not** run linting or formatting (`npm run lint`, `npm run prettier-fix`) here: this skill changes only
`package-lock.json`, never source, so those checks have nothing to act on and only add minutes. Likewise
`npm run l10n` is irrelevant to a lockfile-only bump. If `npm run build` fails because of the bump, treat it
as a real regression: investigate, and if the target is incompatible, drop that package from the batch and
re-run. A pre-existing, unrelated failure (e.g. a known Windows-only `oxlint`/`tsgolint` false positive that
is green on CI) should be identified as such and reported, not "fixed" by unrelated edits.

### Phase F — Commit and (optionally) PR

1. Stage only the manifest(s): `git add package-lock.json` (and `package.json` only if intentionally
   changed). Commit with a Conventional-Commits subject and the required trailer:
   ```
   build(deps): bump <pkg list>

   <one line per package: name current -> target>

   Targets verified available past the 7-day quarantine on the Microsoft feed, installed from
   registry.npmjs.org so the lockfile resolved/integrity stay canonical npmjs.

   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   ```
2. If the user wants a PR: `git push -u origin <branch>` then `gh pr create` (write the body to a file and
   pass `--body-file`; real newlines, no hard-wrapped sentences, no task-list checkboxes). Never use
   `--force`.

## Constraints

- **Never touch any `package.json`** (root **or** workspace/`packages/*`) unless the user explicitly asks to
  bump the declared ranges. Default is lockfile-only, within existing ranges. Verify with git state across
  all manifests (Phase D step 3), not just the root file.
- **Never write a feed host into a `resolved` URL.** Tarballs come from npmjs.org; the feed is used only to
  discover and gate versions.
- **Never mix registries for one version.** The `integrity` in the lockfile must match the `resolved`
  tarball's registry (npmjs.org).
- **Never jump to a pre-release**, and never exceed npmjs' `latest` dist-tag or the allowed semver range.
- **Never install/update after the Phase C step-2 `resolved` rewrite** — that rewrite is the last lockfile
  mutation; a later `npm install`/`npm update` can re-introduce feed hosts.
- **Never run `npm ci` or delete `node_modules`** as prep or validation — it is unnecessary (the lockfile is
  correct by construction), the slowest step, and fails on IDE-held native binaries (`EPERM`) and
  pre-existing feed URLs (`EALLOWREMOTE`). Repopulate a missing tree, or sync a drifted one, with an
  incremental `npm install` only — or `scripts/sync-tree.mjs`, which wraps that install against the
  `EALLOWREMOTE` trap.
- **Trust the selector, but heed its DRIFT warning.** A tree drifted **ahead** of the lockfile hides rows
  from `npm outdated`; if the selector warns (or reports "0 to bump" unexpectedly), sync and re-run before
  concluding there is nothing to update.
- Do not rewrite pre-existing feed URLs elsewhere in the lockfile that your bump did not introduce.
- Verify every command exits `0`; a nonzero exit stops the workflow.

## Reporting

When done, summarize:

- Scope (every outdated top-level package, or the named subset).
- The bumps applied (`name: current → target`) and any packages skipped or flagged for review (feed ahead
  of npmjs `latest`, pre-release, aliased, or validation-incompatible) with the reason.
- Build result (`npm run build`), calling out any known pre-existing false positives.
- The branch name, and the PR URL if one was opened.

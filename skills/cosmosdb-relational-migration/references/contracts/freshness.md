# Freshness Contract

Read this contract when recording or checking analytical freshness. Project fields
and artifact locations are defined in [project state and artifacts](./project-state-and-artifacts.md).

## Freshness Manifest

Phases from `preflight` through `provisioning` record freshness only in the root
`project.json#freshness[phase]` map, keyed by named phase. Code migration is excluded.
Do not put freshness in a phase `manifest.json` or create another sidecar. Finalize all
phase artifacts and semantic project fields before recording their hashes. Obtain
the current revision through a scoped `project-state.mjs` read, then run:

```bash
node <skill-root>/scripts/freshness.mjs \
  --workspace <workspace> \
  --phase <phase> \
  --write --expect <revision> \
  [--consulted <workspace-relative-path>]...
```

The helper atomically updates the project and prints only the new revision, phase,
and input/output counts, never the full manifest. Without `--write`, it checks the
saved snapshot and reports freshness and stale inputs without changing any files.
Add `--consulted` for each
workspace application, workload, or evidence file materially used beyond mandatory
phase inputs. Exclude peer guidance, including peer files installed inside the workspace;
record their paths and decision rationale only in summaries. Changes to the peer's index,
rules, installation location, or availability do not invalidate completed phases.
Historical `skill-file` entries for `cosmosdb-best-practices` are ignored during validation
without rewriting the checkpoint; newly recorded snapshots omit them. Other required
and consulted migration inputs remain validated. Entries contain stable IDs,
workspace-relative paths, exact file-byte hashes, or canonical hashes
of semantic project values. Object-property order does not affect project-value hashes;
array order remains meaningful. Status, timestamps, run counts, and target verification
observations are excluded from semantic projections. The checkpoint itself is never
hashed as a file: only relevant semantic fields are hashed, avoiding self-reference
and invalidation from unrelated workflow bookkeeping.

Mandatory inputs are:

- `preflight`: selected DDL and raw workload paths and bytes, all three source
  selections, effective parser choice, application-analysis fields excluding `completedAt`,
  curated volumetrics/access-pattern templates, and the bundled SDK matrix version. The matrix-version hash
  does not make SDK evaluation a preflight gate.
- `discovery`: `preflight-manifest.json` and discovery instructions.
- `assessment`: `discovery-manifest.json` and assessment instructions.
- `schema-conversion`: `assessment-manifest.json`, assessed-domain manifests,
  conversion instructions, assessment-domain selection metadata, and each accepted
  domain's `cosmos-model.json`.
- `provisioning`: canonical `model.json`, the root conversion `manifest.json`,
  `main.bicep`, `main.bicepparam`, `sample-data.json`, `seed-data.csh`, and semantic
  target configuration.

Each entry contains `version: 1`, an `inputs` array, and an `outputs` array. Outputs
bind the snapshot to the authoritative phase JSON manifest, assessment domain
manifests, and canonical conversion model where applicable. Conversion domain models
and deployment files are bound by mandatory inputs. Markdown summaries are checked
for required structure, but are not mandatory freshness hashes unless recorded as
consulted inputs. Editing a hashed output invalidates its phase even when all source
inputs are unchanged. Write artifacts first, record freshness second, and set
completion status only after validation; do not edit hashed artifacts after capture.

Effectively selected raw workload files are mandatory freshness inputs even when their
reviewed disposition is excluded from analysis. Adding, removing, or editing an effective
input, or changing selection/exclusion settings, invalidates the affected preflight
snapshot and downstream analytical checkpoints. Omitted `files` uses the current default
folder contents; a present list uses exactly those entries. `excludedFiles` filters
either mode. Editing only the bytes of a source-selection-excluded file does not invalidate
freshness, but changing its exclusion setting does. Exclusion never deletes its source.
Managed templates are hashed separately, not counted as raw workload files. A valid
freshness snapshot does not replace the `workloadInputs` coverage check. Historical
snapshots lacking required raw-input hashes or selection hashes must be regenerated
after evidence review; do not silently upgrade them to current.

Completion reports `current`, `stale`, or `unknown` with `staleInputs`. It verifies
recorded consulted files remain inside the workspace after symlink resolution. A phase
is current only when its own freshness entry matches and its required predecessor is
current and complete. Missing checkpoint freshness entries are `unknown`.
Do not synthesize a baseline from current files without rerunning the phase.
Stale and unknown phases are incomplete without changing persisted status
or deleting reviewable output. Exact restoration may make a phase current again.

Code-migration completion instead validates a historical execution record and reports
`not-applicable` with no stale inputs. No freshness manifest is needed for this phase.
Iteration-time validation still checks current design inputs, SDK compatibility,
output files, and recorded repository checks.
The accepted-model handoff deliberately does not require live application-source
freshness. It preserves structural and cross-artifact validation without altering
normal analytical freshness or copying source files. See
[code-migration.md](../phases/code-migration.md) for launch, completion, and recovery behavior.

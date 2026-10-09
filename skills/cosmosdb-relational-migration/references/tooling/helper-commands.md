# Helper Commands

Run `node <skill-root>/scripts/<helper>.mjs --help` before using an unfamiliar command
or after a usage error. Help is the per-command argument contract; phase references
define when to run it. Do not run every helper as a checklist.

All executable helpers accept `--help` and `-h`, returning text on stdout and exit 0
without reading workspace inputs, writing, installing, or spawning subprocesses.
Help takes precedence over other arguments. Normal command output is generally JSON;
read the result as well as the exit code. Do not forward skill invocation inputs as
flags unless that command lists them. In particular, resource authorization remains
an agent/host responsibility, not a flag on these local helpers.

## Paths and Results

- `<workspace>` is the application root, not its `.cosmosdb-migration` directory.
- Relative CLI file paths resolve from the current working directory, not from
  `--workspace`. Prefer absolute file paths when invoking from another directory.
- Exceptions are explicitly named: `--artifact` and freshness `--consulted` use
  workspace-relative paths. Estimator `--rule` is a filesystem path used to estimate
  context size, not a freshness input or peer-relative identifier.
- Peer guidance is excluded from freshness. Keep applied paths and rationale in
  summaries; do not add peer files to consulted workspace inputs. Historical peer-file
  freshness entries are ignored. Completion and inspection do not need a peer installation;
  new Cosmos DB decisions still require the peer Skill.
- Use separate option/value arguments, quote paths or JSON containing spaces, and
  replace placeholders. Brackets and ellipses in examples describe optional/repeated
  arguments; do not pass them literally.
- Value-taking options reject omitted, empty, whitespace-only, or option-like values
  with exit 1 before doing work. Use `./--filename` or an absolute path for filenames
  beginning with a flag-like prefix. Negative numbers and JSON literals remain values;
  each command still validates their meaning. `--toc` alone intentionally selects the
  root, and `--help`/`-h` still take precedence over argument validation.
- `--offset`/`--limit` paginate diagnostics or reads, not validation. Completion's
  `--artifact` filters diagnostics only. Never treat one page as the entire result.
- Inspector exit 0 means routing succeeded, not completion; inspect `action` and
  `completion`. Freshness inspection may exit 0 with `stale` or `unknown`. The SDK
  checker may exit 0 with unsupported languages. Completion exits 0 only if complete.
- Validators establish recorded structure/evidence, not semantic correctness of the
  agent's reasoning or the current state of live cloud resources.

## Workflow Commands

| Helper | When to use | Effects |
| --- | --- | --- |
| [inspect-migration-state.mjs](../../scripts/inspect-migration-state.mjs) | Initial routing and raw input discovery; use `--inputs <source>` with `--offset`/`--limit` to enumerate every page | Read-only; phase routing includes `inputCounts`; input pages return paths, sizes, and hashes without file contents |
| [project-state.mjs](../../scripts/project-state.mjs) | Scoped reads and revision-checked checkpoint updates | Read-only by default; `--init`/`--set` write project state |
| [freshness.mjs](../../scripts/freshness.mjs) | Record finalized analytical inputs/outputs, or diagnose staleness | `--write --expect` writes hashes, not regenerated artifacts |
| [check-phase-completion.mjs](../../scripts/check-phase-completion.mjs) | Authoritative gate after relevant writes | Read-only, full phase validation |
| [check-sdk-compatibility.mjs](../../scripts/check-sdk-compatibility.mjs) | Discovery-owned language classification | Read-only by default; `--output` replaces a report |
| [estimate-domain-tokens.mjs](../../scripts/estimate-domain-tokens.mjs) | Assessment working-set estimate; exact host tokenizer preferred when available | Read-only; unknown context budget never proves fit |
| [select-schema-conversion-domains.mjs](../../scripts/select-schema-conversion-domains.mjs) | Select mapped domains, or all when explicitly requested | Read-only |
| [validate-schema-conversion-domains.mjs](../../scripts/validate-schema-conversion-domains.mjs) | Batch-check models and summaries before merge | Read-only; avoids individual domain validator calls |
| [merge-cosmos-models.mjs](../../scripts/merge-cosmos-models.mjs) | Deterministic merge of accepted domain models | Replaces canonical output only after successful validation |
| [generate-provisioning-artifacts.mjs](../../scripts/generate-provisioning-artifacts.mjs) | Generate local deployment files; compare with `--check` | Writes local files; `--force` replaces divergent files; never deploys |
| [validate-code-migration-plan.mjs](../../scripts/validate-code-migration-plan.mjs) | Check plan and current iteration evidence | Read-only; validates declared coverage and results, not command execution or test adequacy |

## Optional and Diagnostic Commands

These commands are supported, but they are not extra completion requirements.
Run them when a phase calls for a precondition or a failure needs narrower diagnosis.

| Helper | Purpose and overlap |
| --- | --- |
| [setup-ddl-parser.mjs](../../scripts/setup-ddl-parser.mjs) | Optional pinned SQLGlot environment setup, not a DDL parser; `--install` may use the network and requires the saved choice/host consent |
| [calculate-capacity.mjs](../../scripts/calculate-capacity.mjs) | Optional RU sizing arithmetic; already used internally by capacity reconciliation during merge |
| [identity-mapping.mjs](../../scripts/identity-mapping.mjs) | Resolve one item's ID; identity logic is already used by sample validation |
| [validate-migration-project.mjs](../../scripts/validate-migration-project.mjs) | Project-shape diagnosis; already included in state writes, inspection, and completion |
| [validate-cosmos-model.mjs](../../scripts/validate-cosmos-model.mjs) | Model diagnosis with `--check`; default prints the full canonical model, and `--output` writes it; batch/merge/completion already validate models |
| [validate-schema-conversion-summary.mjs](../../scripts/validate-schema-conversion-summary.mjs) | Summary diagnosis; domain mode defaults to sibling `cosmos-model.json`; already in batch/completion |
| [validate-conversion-evidence.mjs](../../scripts/validate-conversion-evidence.mjs) | Isolate cross-model/source evidence failures; already in completion; workspace is positional |
| [validate-sample-data.mjs](../../scripts/validate-sample-data.mjs) | Sample precondition or diagnosis; generation, verification, and completion already validate samples |
| [validate-provisioning-verification.mjs](../../scripts/validate-provisioning-verification.mjs) | Recorded verification diagnosis; already in provisioning completion; does not query live resources |

Generation validates models and samples before writing artifacts. Do not immediately
repeat sample validation after a successful generation on unchanged inputs. Recheck
after samples, models, identity mappings, or source evidence change and before seeding.
After finalizing artifacts, freshness, and checkpoint fields, run the completion gate
once. Standalone validator success never replaces that gate.

## Import-Only Modules

These files support the commands above and have no command-line entry point:

| Module | Consumers and responsibility |
| --- | --- |
| [phase-names.mjs](../../scripts/phase-names.mjs) | Inspection, completion, freshness: normalize phase identifiers |
| [phase-summary.mjs](../../scripts/phase-summary.mjs) | Validators: read evidence/model JSON and Markdown sections |
| [reconcile-capacity.mjs](../../scripts/reconcile-capacity.mjs) | Model merge: reconcile capacity contributions before sizing |
| [validate-source-evidence.mjs](../../scripts/validate-source-evidence.mjs) | Completion and provisioning validators: inventory, hashes, source identity |
| [cli-help.mjs](../../scripts/cli-help.mjs) | All executable helpers: side-effect-free help dispatch |
| [cli-arguments.mjs](../../scripts/cli-arguments.mjs) | Option-taking helpers: reject missing values before reading inputs or performing work |

The optional parser's [requirements-ddl.txt](../../scripts/requirements-ddl.txt) pins its
dependency; it is not an executable helper. Keep shared modules even when they are
not agent-facing commands. No helper needs to be invoked solely because it is packaged.

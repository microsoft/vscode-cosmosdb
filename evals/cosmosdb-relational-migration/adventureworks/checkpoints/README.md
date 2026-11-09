# AdventureWorks prerequisite snapshots

These are versioned, reviewed **inputs**, not expected outputs for the phase under test.
Each folder contains only the newly completed phase's artifacts and a cumulative project-state
projection. Setup overlays the predecessor folders in order:

| Phase under test | Input snapshots |
| --- | --- |
| Preflight | None; supplied DDL and synthetic workload only |
| Discovery | Preflight |
| Assessment | Preflight, discovery |
| Schema conversion | Preflight, discovery, assessment |
| Artifact-only provisioning | Preflight, discovery, assessment, schema conversion |
| Code-migration planning | Preflight, discovery, assessment, schema conversion; no provisioning required |

The inference scenario receives no snapshots or supplied DDL. It owns its required preflight work.
The opt-in chained integration scenario also starts without snapshots.

## Provenance and review

The snapshots originate from the retained GPT-6.1 Terra/Astra comparison run
`92961e95-1d91-46b9-90a7-29636fa373e6`, full-migration scenario. That run completed the analytical
phases and passed the independent artifact checks. Its holistic LLM judge did **not** pass:
the judge exhausted its evidence budget and reported insufficient inspection. The snapshots are
not described as a fully passing live answer or proof of production readiness.

Review covered the independent twelve-table/column/key/relationship inventory, controller access
coverage, domain ownership, canonical/domain consistency, and the explicit source-preservation
design and limitations in the root/domain summaries. The accepted conversion is a **conditional,
undeployed** design: its coordinator, source-compatible comparator, content store and verification
obligations remain future work. They must be preserved by provisioning/planning evaluations, not
silently treated as implemented infrastructure. The fixture does not prescribe that design for a
new schema-conversion run, which never receives conversion outputs.

The upstream application is pinned to commit `d548c0ddb3e3a464fa34c1fdc39c2333506b42cc`.
Only application-independent migration artifacts are stored here. Supplied DDL and workload are
materialized from the normal versioned fixtures. During import, source hashes were reconciled with
the committed DDL's normalized trailing newline; no SQL definitions were changed. Per-run activity,
historical instructions, provisioning outputs, application plans and memory were omitted.
The Orders summary's inconsistent detail docType table label was corrected to `salesOrderDetail`,
matching both the canonical and domain models; identity templates and model content were unchanged.
Known synthetic workload limitations, including the BuildVersion row-count warning, are retained;
phase isolation does not revise workload assumptions.

Each `checkpoint.json` binds the application revision, exact schema/workload bytes, phase file hashes,
project state and consulted paths. Setup verifies these bindings before copying anything. It then
reconstructs freshness for the fixture in its new isolated workspace and runs the normal completion
validators for **every** predecessor. This is fixture materialization, not permission for an agent to
refresh hashes over stale analytical outputs. The grader independently rejects changes to predecessor
artifacts and phase metadata, or new artifacts outside the requested phase.

Snapshots are excluded from automatic formatting because formatting changes would invalidate their
reviewed hashes. To update a fixture, review its evidence and limitations, update the corresponding
hashes deliberately, and validate every consuming phase. Never refresh snapshots automatically from
the outputs of the current test run.

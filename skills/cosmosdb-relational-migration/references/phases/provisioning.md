# Target Provisioning (`provisioning`)

`provisioning` generates deployment and seed artifacts. It applies resource and data
mutations only when the current invocation explicitly sets
`allow-provisioning: true`.

## Expected Output Artifacts

Required before provisioning can be marked complete:

- `phases/4-provisioning/main.bicep`.
- `phases/4-provisioning/main.bicepparam`.
- `phases/4-provisioning/sample-data.json`.
- `phases/4-provisioning/seed-data.csh`.
- `phases/4-provisioning/summary.md`, including target observations and validation.
- `project.json` with verified provisioning metadata and
   `phases.provisioning.status: "complete"`.

Explain and obtain approval before adding target-specific deployment artifacts beyond
the four executable inputs and one summary. Only approved additional artifacts become
conditional requirements in `phases.provisioning.artifactPaths`.

## Prerequisites

- `schema-conversion` status is `complete`.
- The canonical root `model.json` passes validation again.
- A target environment is configured or can be selected with the user.
- Target-specific best-practice concepts are covered.

Before target discovery, read `/phases/targetEnvironment` explicitly from the project,
directly or with `project-state.mjs --workspace <workspace> --get /phases/targetEnvironment`.
Honor the saved `type` even when `verified` is false or the endpoint is missing.
For `emulator`, resolve only the emulator endpoint; do not enumerate Azure accounts.
If no type is selected, ask for the target type before account discovery. A status-only
summary is not evidence that target configuration is absent.

## Feasibility Handoff

Before authorized mutations, reconcile the schema-conversion summaries' feasibility
assumptions and clearance conditions with the actual target configuration and selected
provisioning tools. Apply the
[service-constraint reconciliation](../workflow/best-practices-integration.md#reconcile-service-constraints)
procedure, including capacity mode, partition-key configuration, required capabilities,
and applicable throughput minima. For absent resources, check the proposed configuration
before creation and observed settings afterward; do not invent target observations.

### Capacity Compatibility

Record observed account mode in `phases.targetEnvironment.capacityMode` (`serverless`
or `provisioned`) before mutation; never infer it from the model or missing throughput.
For new accounts, record the approved mode and confirm it by readback.

| Model | Selected Azure account | Action |
| --- | --- | --- |
| Serverless | Serverless | Omit provisioned throughput settings. |
| Serverless | Provisioned | Compatible; use approved target autoscale throughput without changing the model. |
| Provisioned | Provisioned | Use modeled throughput, respecting service minima. |
| Provisioned | Serverless | Cannot satisfy provisioned throughput requirements; select or create a provisioned account. |

For a serverless model on provisioned Azure, offer the selected account with approved
autoscale throughput or a new serverless account in the same resource group and subscription,
reusing the location where supported. Neither requires a model rewrite or schema-conversion rerun.
Store the approved per-container maximum in `phases.targetEnvironment.maxThroughput`:
a multiple of 1,000 RU/s, at least 1,000, respecting service minima. Disclose ongoing
cost and review existing or shared throughput before applying changes.

Switch targets only after approval; a new account needs a distinct, available name.
Preserve the existing account and resource-group/subscription coordinates, following
[Account Creation and Adoption](#account-creation-and-adoption).

Emulator capacity mismatches in either direction are warnings, not blockers. Record
actual mode when known; otherwise default to provisioned. A provisioned emulator
uses modeled throughput, or 1,000 RU/s autoscale per container for a serverless model
unless a target maximum was selected. A serverless emulator omits throughput settings
even for a provisioned model. Keep the canonical model and Azure Bicep unchanged.
Record the testing-only warning in the summary: no production throughput or serverless
parity is proven, and no Azure switch is authorized. Regenerate artifacts and recheck
capacity requirements when an Azure target is selected later.

Block the affected operation on incompatibilities or unmet clearance conditions.
Record evidence and resolutions in the existing provisioning summary. Consequential
capacity changes need explicit approval with their post-import cost implications;
compatible target overrides above do not require design changes. Reconcile actual
design changes with owning domain/merge inputs, not root-only model edits.
Never silently reconfigure adopted accounts or bypass validators to make a plan fit.

This phase still provisions resources and synthetic samples only. Import feasibility
planning does not authorize production-data transfer or temporary bulk-import scaling.
Carry import-specific runtime checks forward; successful sample seeding does not
prove production-import feasibility or clear those checks.

## Account Creation and Adoption

The existing version 1 target fields determine artifact generation. Only
`targetEnvironment.type: "provision"` without an endpoint generates an account
creation declaration. An `azure` target or a `provision` target with an endpoint
uses a name-only Bicep `existing` account reference. Missing target intent and
emulator targets also default to an existing reference; emulator execution uses
the seed script, not an Azure deployment. Do not clear an endpoint to force creation.

The adoption template manages only the modeled database and containers. It does not emit account
properties, a location parameter, or automatic account-wide role assignments.
Preserve authentication, regions, failover, zone redundancy, consistency, capabilities,
networking, backup settings, and existing access grants. Check the observed capacity
mode against [Capacity Compatibility](#capacity-compatibility) and verify required
capabilities before applying child resources. Offer a compatible account in the same
resource group if needed; resolve missing access below without changing account settings.

Before any new-account deployment, read the exact target account in the selected
subscription and resource group. An authorization or lookup failure is not evidence
of absence. If the account already exists, confirm that it is the intended target,
persist its endpoint, and regenerate adoption-only artifacts. If it is absent,
review the proposed new-account settings and required role assignments with the user
before creation. Preview the
deployment in incremental mode and stop if it would modify an existing account or
unrelated resources. Never use complete-mode deployment for these artifacts.

After successful creation, persist the endpoint before generating final resource/data
artifacts or retrying. Preserve `type: "provision"` when it records migration ownership;
the endpoint makes subsequent generation adoption-only. Regenerate and validate the
final artifacts and freshness after this transition; old creation artifacts must not
pass completion checks against an adopted target.

`allow-provisioning` is not authorization to reconfigure an adopted account. Any
change beyond the required migration grants below requires a separate explicit decision in
the current invocation, with observed settings, proposed diff, impact, and approval
recorded in the existing provisioning summary. Do not add such changes to the
deterministic adoption template or claim that its validator proves preservation of
live settings. The host must inspect the deployment preview and resulting account.

With `allow-provisioning: true`, establish required access for new and existing Azure
accounts before testing connectivity. Identify the migration principal; reuse sufficient
grants or attempt the minimum missing management-plane and Cosmos DB data-plane roles
using the signed-in user's authority. Use Cosmos DB Built-in Data Contributor for migration
reads/writes at the narrowest scope supporting the workflow. Include new-account grants
in the initial approval; perform existing-account grants separately from the adoption template.
Respect host consent controls and retry connectivity with bounded backoff for RBAC propagation.
If a grant is denied or access still fails, block the step and report the principal, role,
scope, Azure error code, and required administrator action. Never bypass denial with broader
privileges or account keys. Record the outcome in the summary. Emulator targets need no Azure RBAC.

## Artifact Generation

Follow the identity contract in [validation-evidence.md](../contracts/validation-evidence.md).
Preserve and validate `identityMapping` in `phases/3-schema-conversion/manifest.json`;
generation, sample validation, and target verification must use the same mapping. Read the domain
summaries for embedding and relationship context that the canonical model omits.

1. Generate `main.bicep` from the canonical model.
2. Generate or refine `main.bicepparam` without silently overwriting user edits.
3. Generate `sample-data.json` from model attributes, identity templates,
   partition keys, and relationships using the Sample Data Contract below.
4. Validate sample data before insertion: container and document-type coverage,
   embedded-only handling, field names and types, IDs, partition-key values,
   uniqueness, references, nesting depth, and item size.
5. Generate an idempotent `seed-data.csh` script.
6. Compare model capabilities with generated Bicep. Unsupported TTL,
   regional, consistency, or other fields block deployment or produce an explicit
   warning; never drop them silently.

Generate only synthetic sample data. Preserve modeled fields, including credential-named
fields such as `password` or `token`, and populate sensitive fields with clearly fake,
nonfunctional values. Never copy real credentials from configuration, environment
variables, secret stores, or production records into sample data. Keep deployment
authentication separate from sample documents and supply it through the host's normal
runtime credential mechanisms. Sample validation checks structure and model alignment;
it does not prove that values are synthetic or free of secrets.

Artifact generation does not require cloud-mutation authorization.

Generate all deterministic deployment artifacts together:

```bash
node <skill-root>/scripts/generate-provisioning-artifacts.mjs \
   --model <workspace>/.cosmosdb-migration/phases/3-schema-conversion/model.json \
   --sample-data <workspace>/.cosmosdb-migration/phases/4-provisioning/sample-data.json \
   --project <workspace>/.cosmosdb-migration/project.json \
   --output <workspace>/.cosmosdb-migration/phases/4-provisioning
```

The command refuses to overwrite a divergent artifact unless `--force` is supplied.
Use `--check` to verify byte-stable parity without writing. During an explicit or
autonomous regeneration, show or record the existing diff, then use `--force` for
phase-owned generated artifacts without requesting another confirmation; the
regeneration instruction is the authorization to replace those artifacts. Outside a
regeneration, never pass `--force` without showing the diff and obtaining confirmation.
This does not authorize cloud mutations or replacement of user-managed files.

The generator already validates the model and sample data before writing the seed
script. Do not repeat that validation immediately after successful generation on
unchanged inputs. To diagnose a sample failure, or recheck changed samples, model,
identity mappings, or source evidence before applying mutations, run:

```bash
node <skill-root>/scripts/validate-sample-data.mjs \
   --workspace <workspace> \
   --model <workspace>/.cosmosdb-migration/phases/3-schema-conversion/model.json \
   <workspace>/.cosmosdb-migration/phases/4-provisioning/sample-data.json
```

The validator enforces facts represented by the canonical model and the generated
version-2 partition-key baseline: resolved IDs are limited to 1,023 UTF-8 bytes, and
each string partition-key component is limited to 2,048 UTF-8 bytes. Limits use value
bytes, not character counts or JSON escaping.
Oversized values block artifact generation without truncation or identity changes.
These sample checks do not establish that every source row or future write fits, nor
do they establish the limits of existing containers.

For modeled relationships, the validator resolves the complete source foreign key
from the authoritative inventory. It checks ordered composite-key reference targets,
embedded placement at `targetProperty`, embedded field shapes, and parent-child key
consistency. Relationships absent from the canonical model and account capabilities
remain explicit evidence checks; do not report them as structurally validated.

## Sample Data Contract

- Generate 3-5 distinct sample documents per standalone entity type in every
   modeled container, not 3-5 per container in total. Include every standalone
   `docType`; never duplicate item keys just to meet the count.
- Include every mapped attribute with the exact canonical name, JSON type, and
   entity `docType` value. Use varied, plausible synthetic values, including
   representative dates, amounts, and relationship cardinalities. Distribute
   unrelated aggregates across realistic partition-key values while keeping
   documents belonging to one transactional aggregate in the same full key tuple.
- Follow the [target attribute type contract](./schema-conversion.md#target-attribute-types)
   for standalone and embedded fields. Unsupported target labels fail model validation;
   sample values are never coerced. Null is accepted only for an explicit `null` type,
   and missing mapped fields still fail. A string representation of a precise decimal
   or large integer must remain a string with its exact digits. Identity and partition-key
   requirements remain unchanged; explicit null support does not relax them.
- Resolve each `id` from its `idTemplate` and the selected identity mapping.
   Preserve the corresponding source-key values in their separate mapped fields.
   For `{uuid}` fallback entities, generate a valid UUID once and persist it directly
   as the synthetic document's `id` in `sample-data.json`; validation and seeding reuse
   that value. Generate a replacement only during explicit sample-data regeneration.
   Native UUID and encoded composite identities follow the shared identity contract.
- For `strategy: "embed"`, place child data at the documented parent property or
   array, using the child's mapped fields. Entities with `isEmbeddedOnly: true`
   appear only inside parent documents and have no standalone sample quota. Show
   bounded, representative child collections rather than creating independent
   child items to satisfy coverage.
- For FK-backed `strategy: "reference"` relationships, keep the source-key value
   in the mapped foreign-key field, not the target's derived Cosmos `id`. For
   example, an order's `customerId: 101` matches a customer with `customerId: 101`
   and `id: "customer-101"`. Resolve the actual source FK and referenced key from
   the authoritative DDL, attribute mappings, and summaries; target field names
   need not be identical. Match every component and JSON type of composite keys.
- When the accepted model separately defines document-ID reference fields,
   populate them with the target's resolved `id` and supply the routing values
   required by the documented lookup. Do not invent extra fields or overwrite
   preserved source keys. A point read needs both the target `id` and complete
   partition key; natural-key matching is application-side reference resolution,
   not a cross-document or cross-container SQL JOIN.

Create sample identities before linking references so cycles can be resolved.
Every required reference must resolve to a sample of the intended target entity
with matching source-key values and the documented partition scope. Do not infer
targets from similarly named fields alone. If a target is outside the selected
migration scope or its mapping is ambiguous, record and resolve that dependency
before claiming referential consistency.

Before insertion, count documents by standalone `docType`, inspect embedded
placement, and check reference targets across the complete sample set. Record
counts, checks, and unresolved issues in the existing provisioning summary.
The structural validator checks modeled relationship consistency and standalone-type
presence, but not the 3-5 generation quota, representative cardinality, or relationships
that the canonical model does not describe. Its successful exit does not replace these
generation and evidence checks.

## Seed Script Shell Contract

Minimum required version: [Cosmos DB Shell](https://github.com/Azure/CosmosDBShell)
`1.1.250-preview` or newer. Check the actual executable with `cosmosdbshell -c version`
and compare using semantic version precedence, not string ordering. A stable release
with the same numeric version is newer than its preview; build metadata does not
affect precedence. Keep any installed version at or above the minimum unchanged,
even when another release is available. Update only if the installed version is lower
than `1.1.250-preview`; never downgrade or reinstall merely to match the minimum.
If the version cannot be determined, report that uncertainty instead of assuming it
is outdated. The minimum version does not replace capability validation: require
structured JSON command help,
`create` with `--scale`, `--ru`, and `--index_policy`, `index set`,
`throughput autoscale` with `--yes`, and `mkitem --upsert`, with explicit database and
container options.

If `dotnet` is available on the host, check `dotnet --list-sdks` for a .NET 10 or
newer SDK and inspect `dotnet tool list --global`. The runtime alone is insufficient.
When the Shell is missing, suggest:

```bash
dotnet tool install --global CosmosDBShell --prerelease
```

Only when the installed global tool is below the minimum, suggest:

```bash
dotnet tool update --global CosmosDBShell --prerelease
```

These commands select the latest available version, including previews. Verify the
resolved version meets the minimum before using it; do not accept an older package
just because installation succeeded.

Explain that these commands download packages and change a user-global tool. Obtain
approval under the host's installation and network controls before executing either
command; provisioning authorization does not imply permission to install tools.
If no version meeting the minimum is available from configured feeds, follow the Shell's
[installation instructions](https://github.com/Azure/CosmosDBShell/blob/main/README.md)
and use an approved package source via `--add-source`, retaining the minimum-version requirement.
Do not assume a sibling source checkout or locally built packages exist. If `dotnet`
or a suitable SDK is unavailable, suggest the documented Shell installation options
or approved SDK setup instead of attempting tool installation. Never request feed
credentials through chat.

After an approved installation or update, verify `cosmosdbshell -c version` and use
the actual executable on the host's PATH. Before running the seed script, require
this read-only check to exit 0:

```bash
node <skill-root>/scripts/generate-provisioning-artifacts.mjs \
   --check-shell <cosmosdbshell-executable>
```

The check executes only local `help` commands. It does not connect, inspect credentials,
install software, or mutate resources. Missing capabilities or invalid command help
block script execution; report the diagnostic and request a compatible executable.
For a version at or above the minimum, investigate the capability failure rather than
automatically updating it. Never remove `--upsert` or substitute create-only writes to make
an old installation work. Artifact generation itself still requires only Node.js.

The script uses `connect $1`, not a quoted literal `$1`, and reads sample data from `$2`.
For Azure, resolve and persist `subscriptionId` and `resourceGroup`, then regenerate
so the connection includes `--subscription` and `--resource-group`. Use Entra authentication
and confirm `connect` reports the intended `armAccountId` before resource operations.
Missing ARM context or denied ARM access blocks execution; do not silently fall back
to data-plane throughput calls. Emulator connections omit these options.
Arguments are Cosmos Shell syntax, not POSIX shell syntax; single quotes inside literal
index-policy JSON are doubled. Follow the Shell's
[scripting documentation](https://github.com/Azure/CosmosDBShell/blob/main/docs/programming.md).
Do not embed credentials in artifacts or copy secrets into chat.

Azure seed scripts are always data-only: connect, load fixtures, and run scoped
`mkitem --upsert`. Deploy and verify `main.bicep` first; it owns database/container
creation, indexing, and throughput. Do not replay `create`, `index set`, or
`throughput` commands against Bicep-created resources. Unspecified targets also
produce data-only scripts; select and verify a target before execution.

Only emulator scripts without container-level full-text or unique-key policies
include resource operations. They reuse configured names, apply `index set` after
create-if-missing, and use `--scale=auto --ru=<maxThroughput>` plus
`throughput autoscale` for provisioned capacity. Review changes and immutable settings
first. On a mismatch, stop for resolution; never delete/recreate containers, silently
rename them, or run an emulator resource script against Azure.

Check every modeled container name and its immutable settings before the first
mutation, not incrementally during execution. Treat failed lookups as unresolved,
not evidence of absence.

Emulator models containing `fullTextPolicy` or `uniqueKeyPolicy` also use seed-only
scripts. Provision and verify those containers through a supported SDK first;
Shell's `--index_policy` cannot configure these container-level policies.
For unique keys, compare every existing container's policy before mutation. Policies
are creation-only; a mismatch requires an approved new-container and data-migration
plan, never an in-place update or automatic deletion/recreation. Check full-text
support, including any language/array-path preview features,
using the current [full-text documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/full-text-search).
If no supported provisioning route exists (including on an emulator), stop; do not
strip the policy, assume emulator support, or enable account features implicitly.

The `--yes` throughput option only avoids a repeated Shell prompt; it does not grant
invocation-level provisioning authorization. A nonzero script exit, failed item result,
or verification mismatch leaves provisioning `in-progress`. Preserve successful work
and rerun against the same names and item keys after resolving the failure. Require
the verification report and point reads even when the script exits 0.

If a target-specific workaround is needed, record the exact credential-free
execution adjustment and verification in the existing summary. Distinguish verified
final state from successful replay of the unchanged generated script.

The portable generator tests cover data-only Azure seeding, emulator configuration updates, upsert flags,
quoting, and stale-artifact rejection. To exercise the real Shell parser and option
binder without a connection, set `MIGRATION_COSMOS_SHELL_EXECUTABLE` to a compatible
binary and run `node --test <skill-root>/tests/generate-provisioning-artifacts.test.mjs`.
The enabled test must fail, not skip, when capabilities or syntax differ. It parses the
generated Azure and emulator scripts in unexecuted branches and checks that sample
writes and emulator resource commands reach the disconnected-state guard rather than argument errors. This proves
command compatibility, not live mutation, configuration convergence, or write success;
safe-target provisioning tests and observed verification remain separate requirements.

## Authorization Gate

When `allow-provisioning` is not explicitly true:

- Do not create accounts, databases, containers, roles, or items.
- Leave provisioning incomplete.
- Report generated artifact paths and the exact authorized resume action.

Do not infer authorization from `targetEnvironment`, `verified`, a prior session,
or the existence of deployment files.

## Scoped Provisioning Operations

When `provisioning-step` is supplied, execute only the requested operation:

- `target-account`: create the configured account only when it is absent; otherwise
   adopt it without changing its settings. Persist its endpoint, establish required access, verify the connection,
   and stop. Do not create migration containers or insert sample data. The full
   generated template includes child resources and cannot be applied for this step.
- `resources-and-data`: revalidate the canonical model, generate and validate all
   provisioning artifacts against an existing account endpoint, create or update
   the database and containers, insert sample data, verify the results, and stop.
   If the account is absent, stop and request the separate `target-account` step.

Both focused steps require `allow-provisioning: true`. A successful
`target-account` step does not mark the phase complete. After either step, run the
normal provisioning completion check and mark complete only when the full phase
contract passes.

## Authorized Provisioning

1. Display or record target subscription/account, resource group, region,
   database, containers, throughput mode, and data effects before mutation.
2. Establish required access, then verify credentials and connection using the host's normal consent controls.
3. Use idempotent create/update operations and item upserts.
4. Respect retry-after responses and do not rely on burst capacity for sustained
   work.
5. Verify account capabilities, database, partition keys, index policies,
   throughput, container count, and sample item results.
6. Record warnings for partial sample insertion; do not claim complete success.

Set provisioning status to `complete` only after resource verification. Persist
database name, created containers, sample-data status, and `completedAt` in the
existing version 1 fields.

Record `verification` in the provisioning `manifest.json` after observing
the target. After generated deployment inputs and the summary are final, record
`project.json#freshness.provisioning` through the freshness helper, then validate the
verification manifest. The validator reads its `verification` object, not the Markdown
summary. Do not write a separate verification file:

```bash
node <skill-root>/scripts/validate-provisioning-verification.mjs \
   --model <workspace>/.cosmosdb-migration/phases/3-schema-conversion/model.json \
   --sample-data <workspace>/.cosmosdb-migration/phases/4-provisioning/sample-data.json \
   --project <workspace>/.cosmosdb-migration/project.json \
   <workspace>/.cosmosdb-migration/phases/4-provisioning/manifest.json
```

Set `modelSha256` to SHA-256 of canonical `model.json`. Record every observed
container's ordered partition keys, indexing policy, full-text and unique-key policies when present,
capacity settings, and one point-read result for every expected sample key, including
the returned document content. Keep failures structured as
`operation`, `resource`, and `code`; completion requires an empty failure list.
Record `fullTextPolicy` beside `indexingPolicy` in each container observation, with
effective per-path languages and paths sorted by name, matching canonical ordering.
Record observed `uniqueKeyPolicy` beside those policies. Constraint/path order is
ignored during comparison, but path case and constraint membership must match.
An absent policy and the service default `{ "uniqueKeys": [] }` both mean no constraints.
Read the settings from the target, never copy expected configuration as evidence.

Record each container's observed `capacityMode` and, for provisioned capacity, its
autoscale `maxThroughput`. Match effective target settings, including selected Azure
maxima or emulator overrides, without changing the canonical model hash. Missing or
mismatched observations fail verification; never substitute expected capacity for readback.

Record observed `indexingMode` and `automatic` values even when the model omits them.
For comparison only, omitted model values mean `consistent` and `true`, matching
generated Bicep. Explicit model values, including `none` and `false`, remain binding.
Verification does not fill missing observations or change canonical model bytes or hashes.

### Readback Evidence

Record `target.endpoint` as the account service endpoint used to construct the client
that performed the reads, not a regional routing URL or an endpoint copied from expected
evidence. Resolve and persist `targetEnvironment.endpoint` before verification, including
the configured emulator endpoint. This binds endpoint-only selections as well as named
accounts; record `accountName` too when it is configured.

Endpoint comparison normalizes DNS casing, trailing slashes, and default ports.
Different hosts, nondefault ports, or protocols identify different targets. Azure
endpoints must use HTTPS; HTTP is also supported for configured emulator endpoints.
Do not include credentials, paths, query parameters, fragments, connection strings,
authorization headers, access keys, or tokens in endpoint evidence.

Each `sampleItems` entry requires `containerName`, `id`, ordered `partitionKeyValues`,
`found: true`, and `document`: the actual JSON object returned by the point read.
Never substitute expected samples or upsert request bodies for read responses.
Missing, duplicate, extra, or wrong-key observations prevent completion.

Document comparison ignores object-property order and only the top-level service
properties `_rid`, `_self`, `_etag`, `_attachments`, `_ts`, and `_lsn`. Array order,
JSON value types, nulls, all application fields, and nested properties remain binding,
including nested properties whose names match service metadata. Missing, changed, or
extra application content fails verification. Record only the synthetic samples;
do not copy unrelated production documents or secrets into the manifest or telemetry.

The host performs actual resource and point reads under its normal consent and
authentication controls. The validator checks recorded evidence, not live resources,
and cannot attest that observations were honestly collected. If readback finds drift,
report it and obtain authorization before corrective mutations.

Artifact-only execution without `allow-provisioning` intentionally remains
incomplete even when all generated files exist. A complete provisioning flag with
any missing required artifact is stale and requires regeneration or repair.

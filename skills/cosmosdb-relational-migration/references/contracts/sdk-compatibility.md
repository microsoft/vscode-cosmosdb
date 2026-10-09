# Azure Cosmos DB for NoSQL SDK Compatibility

`discovery` must evaluate whether each authoritative application language can use a
first-party Azure Cosmos DB for NoSQL SDK. A valid unsupported classification does
not block discovery, assessment, schema conversion, provisioning, or code-migration
planning. Missing or invalid SDK evidence prevents discovery completion until repaired.

## Built-In Matrix

The executable source of truth is
[`check-sdk-compatibility.mjs`](../../scripts/check-sdk-compatibility.mjs). It is
bundled with this Skill because `cosmosdb-best-practices` provides SDK usage
guidance but does not define the supported-language matrix.

| SDK family | Application languages | Support level | Package |
|---|---|---|---|
| .NET | C#, .NET | stable | `Microsoft.Azure.Cosmos` |
| .NET interoperability | F#, Visual Basic .NET | stable SDK through the .NET runtime | `Microsoft.Azure.Cosmos` |
| Node.js | JavaScript, TypeScript, Node.js | stable | `@azure/cosmos` |
| Java | Java | stable | `com.azure:azure-cosmos` |
| JVM interoperability | Kotlin, Scala, Clojure, Groovy | stable Java SDK through JVM interoperability; verify framework support | `com.azure:azure-cosmos` |
| Python | Python | stable | `azure-cosmos` |
| Go | Go | stable | `github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos` |
| Rust | Rust | public preview; not recommended for production workloads | `azure_data_cosmos` |

The matrix records SDK availability, not feature parity. A supported language can
still require a warning when its SDK lacks a feature required by the
`schema-conversion` model.

## Official Sources

- [Azure Cosmos DB for NoSQL SDK quickstarts](https://learn.microsoft.com/azure/cosmos-db/quickstart-dotnet)
  has the current shared language selector for .NET, Node.js, Java, Python, Go,
  and Rust.
- [Rust SDK quickstart](https://learn.microsoft.com/azure/cosmos-db/quickstart-rust)
  records that Rust is in public preview without a service-level agreement and
  is not recommended for production workloads.

Microsoft Learn is authoritative when it conflicts with the bundled matrix. The
bundled matrix remains the deterministic offline baseline until the Skill is
updated.

## Evaluation

Run:

```bash
node <skill-root>/scripts/check-sdk-compatibility.mjs --language "<detected-language>"
```

Pass `--language` more than once for a polyglot workspace. Interpret results as:

- `supported`: a stable first-party SDK is directly available or usable through
  standard runtime interoperability.
- `preview`: an official SDK exists in preview. Warn about support and feature
  limitations.
- `unsupported`: no first-party SDK family is mapped to the language. Warn and
  recommend migrating the project or data-access layer to a supported language,
  or introducing a supported-language service boundary.

Record the returned object under `sdkCompatibility` in
`phases/1-discovery/discovery-manifest.json`. Do not evaluate SDK compatibility during
preflight, include it in `preflight-manifest.json`, or create a separate SDK
classification artifact.

Every valid classification, including `unsupported`, completes this `discovery` gate.
Unsupported status does not block any phase from `discovery` through `provisioning`.
It blocks only application changes in migrate mode because that migration must use a
first-party Cosmos DB SDK. Planning a supported-language boundary remains allowed.

## Report Validation

Discovery and current-iteration plan validation both use `validateCompatibilityReport`
from the bundled checker. Pass the expected languages from the comma-separated
`phases.discovery.applicationAnalysis.language` field; do not infer coverage from the
report's own results. Trim language names, collapse internal whitespace, and compare
case-insensitively. Each expected normalized language must appear exactly once, with
no extra results. Language aliases select an SDK family but do not silently replace a
different expected language label. Empty reports or missing application languages fail.

Reports must retain `version: 1`, the current `matrixVersion` and `matrixVerifiedAt`,
and named language results. Without an explicit documentation override, each result's
status, SDK family/display name, package, and interoperability must match the bundled
matrix. Documentation must use HTTPS on `learn.microsoft.com`, without embedded
credentials. Unsupported results have null SDK family/display name/package and
`interoperability: false`.

The validator derives `overallStatus` from the results: unsupported takes precedence,
then preview, otherwise supported. It derives migration permission from those validated
results, never from the persisted boolean alone. `codeMigrationAllowed` must agree
with that derived permission and `analyticalPhasesAllowed` must be true. Contradictory
flags, missing coverage, or forged mappings return field-specific diagnostics and
block acceptance of the report until repaired or regenerated. This is invalid evidence,
not a ban on analytical work for an unsupported language. Matching byte hashes do not
establish report consistency.

At each new code-migration invocation, the host must still inspect the current
application and target SDK/framework compatibility; the report validates the declared
languages, not language detection or feature parity. Historical execution records do
not reevaluate SDK classifications, input hashes, or current support status.

Do not implement or recommend direct REST calls as an SDK replacement. A
REST-only application migration is outside this Skill's supported workflow.

## Optional Documentation Refresh

When web access is available, scan only official Microsoft Learn Cosmos DB for
NoSQL documentation when:

- A language is unsupported by the built-in matrix.
- The bundled `verifiedAt` date is older than the team's freshness threshold.
- A required feature may not exist in the selected SDK.
- A preview SDK may have changed support status.

Read the shared quickstart language selector and the candidate language's SDK or
quickstart page. If documentation is unavailable, retain the offline result. Do not
rewrite this Skill or its matrix during migration execution.

To override a classification, add `documentationOverride` to that language's result
inside the existing `sdkCompatibility.results` array. This object requires:

- `language`: the same normalized language as the result.
- `status`: the revised `supported`, `preview`, or `unsupported` classification.
- `sdkFamily`, `package`, and `interoperability`: the revised first-party SDK mapping,
  matching the result. Unsupported mappings use null family/package and false interoperability.
- `documentation`: the same HTTPS Microsoft Learn URL as the result, identifying
  the documentation actually reviewed.
- `reviewedAt`: the review date as a valid `YYYY-MM-DD` string.
- `rationale`: a non-empty explanation of the documented support and runtime/framework
  evidence justifying the change.

Update the result's semantic fields and the report's derived flags consistently;
leave the offline matrix provenance intact. An override is per language and cannot
change coverage or authorize migration through a root-level permission override.
Keep warnings about preview support, runtime interoperability, and missing features
visible. Existing reports without overrides remain compatible when they match the
matrix; old free-form override notes must be represented with this evidence before
they can justify a different mapping. Do not create a sidecar.

Validation checks the evidence shape, official URL host, and consistency with the
revised result. It performs no network calls and cannot prove that the cited page
supports the claim. The host must read the source and record truthful conclusions;
an official-looking URL or self-authored rationale is not independent proof of SDK support.

## Warning Contract

For preview, runtime-interoperable, or unsupported results, report:

- Detected language and SDK family, if any.
- Support level and package.
- Official documentation URL.
- Any model feature that the selected SDK may not support.
- Stable-language alternatives appropriate to the application architecture.
- That unsupported status blocks application changes in code-migration migrate mode,
  but permits code-migration planning and every phase from `discovery` through `provisioning`.

Carry warnings into `code-migration-plan.md` so they survive the discovery conversation.

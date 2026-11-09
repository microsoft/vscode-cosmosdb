# Operations Domain

## Purpose

**Representative aggregate root:** dbo.BuildVersion, a representative entry point only; dbo.ErrorLog is a separate
operational record, not its child or a shared aggregate. The DDL has no declared FKs between them. The grouping is a
provisional administrative/diagnostic analysis boundary based on names and source structures, not proof of a shared
lifecycle or owner. Splitting version metadata and diagnostic logs is plausible if external use or operational
ownership establishes separate boundaries; current source evidence does not establish such workloads.

## Tables

| Table | Source key | EF mapping versus access |
|---|---|---|
| dbo.BuildVersion | SystemInformationID (TINYINT identity) | Mapped; no controller access found. |
| dbo.ErrorLog | ErrorLogID | Mapped; no controller access found. |

Both appear in [EF mapping](../../../../Models/sampledbContext.cs). Neither has an application pattern in
[discovery](../../1-discovery/discovery-report.md); external producers, log retention and administration are unknown.
The synthetic 1,000-row assumption for BuildVersion is incompatible with its unique TINYINT key.

## Access Patterns

No controller reads or writes were found for either table. Synthetic read/write TPS are planning placeholders and
do not demonstrate use. Keep the two source tables despite missing application access.

## Cross-Domain Dependencies

No DDL foreign keys to other assessed tables are declared for either table. This does not prove that external
operational workflows do not depend on them.

## Preliminary Recommendations

Preserve both table records, identities, required fields and defaults. Establish actual ownership, retention, access,
size and sensitivity before selecting any target lifecycle or capacity policy. `rules/partition-query-patterns.md`
highlights that unknown access does not justify choosing a key; `rules/model-unique-keys.md` highlights source-key
scope. No target container, partition or TTL policy is selected.

## Estimated Tokens: 108744

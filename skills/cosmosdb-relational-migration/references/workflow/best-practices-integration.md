# Best-Practices Integration

`cosmosdb-best-practices` is a required peer Skill for target Cosmos DB design,
provisioning, query, and SDK decisions. Resolve guidance by meaning from its
current index. Do not treat rule filenames or folder layout as a stable API.

## Locate the Peer Skill

1. Ask the host's Skill mechanism to load the Skill named
   `cosmosdb-best-practices`.
2. If the host exposes installed Skill paths, locate that exact Skill name in
   those roots and read its `SKILL.md`. Confirm its declared name and use that
   location to read the selected guidance.
3. Do not scan unrelated user directories or download dependencies without
   consent.
4. If unavailable, stop before the first Cosmos DB design decision and explain
   that this peer Skill must be installed.

Source application classification and supplied-DDL inventory may proceed without
the peer Skill because they do not make target-design decisions.

## Select Rules by Meaning

The model owns semantic rule selection. Read the current peer `SKILL.md` index once
per phase, consider the decision and workload evidence, and load only the strongest
matching rule bodies. Follow related-rule links when loaded content identifies another
material concern. Reuse each loaded rule body across decisions and domains in that
phase. Read current guidance when starting another phase or explicitly rerunning one;
do not monitor peer files or restart completed phases because their guidance changed.

Use the decision requirements in the phase references as review concerns, not as a
lexical matching specification. Rule titles, paths, scope, meaning, and organization
may change; never require a fixed rule set or assume a previously selected rule still
covers the same concern. If current guidance does not address a material concern, record
that uncertainty instead of inventing guidance or treating keyword overlap as proof of
coverage.

Peer guidance is not a freshness dependency. Do not hash its index or rules for execution
gates, including through workspace consulted-file inputs. Changes, relocation, or absence
of the peer never invalidate completed migration phases. Existing peer-file freshness
entries are ignored without requiring a checkpoint rewrite. The peer remains required
before making new Cosmos DB decisions, not for inspecting or validating completed work.

Record applied rule paths and their effect in the phase summary for traceability.
Rules reached through related links may inform decisions even when not listed directly
in the index. Index formatting is not a machine-readable contract, and structural
validation does not establish semantic relevance or complete rule coverage.

## Reconcile Service Constraints

For consequential limit or capability decisions, verify applicable authoritative
documentation for the planned API, capacity mode, features, and SDK/tooling versions.
Use current peer guidance to inform the design, not as a frozen service contract;
do not copy its general rules or numeric limit tables into this Skill.

Resolve discrepancies using applicable documented service behavior; record consulted
URLs, access dates, differences, and their effect in the existing summary. Ambiguous
or unverified applicability remains explicit uncertainty, not assumed support.
Schema conversion uses source evidence and planned configuration, not target metrics
or pilot deployments. If documentation conflicts with a deterministic validator,
report the compatibility gap and resolve it before promotion; never bypass validation
or silently rewrite its limits.

## Provenance

Record in the relevant Markdown summary:

- The decision and workload evidence.
- Actual loaded rule paths.
- How the selected guidance affected the decision.
- Any material concerns not addressed by current guidance.

Do not add rule provenance to canonical `model.json`.

## Compatibility Tests

Tests verify the freshness boundary without pretending to test semantic judgment:

- Related rules and changed index formatting do not require migration aliases or index membership.
- Peer changes, relocation, or unavailability do not affect checkpoint completion.
- Historical peer-file entries are ignored; newly recorded snapshots omit them.
- Source, configuration, artifact, and consulted workspace evidence changes still invalidate freshness.
- Hard service constraints remain enforced by their owning deterministic validators.

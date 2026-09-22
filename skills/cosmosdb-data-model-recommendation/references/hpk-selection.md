# HPK sources

Where to read authoritative hierarchical-partition-key guidance. The selection rules themselves live in
[SKILL.md](../SKILL.md); this file only points at the sources, so nothing is duplicated.

1. Read the relevant detailed rules discovered through
   [cosmosdb-best-practices](../../cosmosdb-best-practices/SKILL.md).
   Do not duplicate its partitioning rules, limits, examples, or compatibility tables here.
2. For HPK questions the skill does not answer, or guidance that appears outdated or conflicting, consult Microsoft Learn:
   - [Hierarchical partition keys](https://learn.microsoft.com/azure/cosmos-db/hierarchical-partition-keys):
     suitability, key ordering, routing, distribution, and limitations.
   - [Transactional batch](https://learn.microsoft.com/azure/cosmos-db/transactional-batch):
     transaction scope, when a workload needs atomic multi-item writes or a level would be unique per item.
3. Apply the parent skill's selection and reporting rules to the supplied workload.
   The HPK suitability check takes precedence over default-hint preference.
   Cite the rule or documentation section actually read; never claim a link was verified without reading it.

If required guidance remains unavailable or unclear, follow the parent skill's evidence/failure policy.
Do not substitute remembered facts or turn a future scaling possibility into a present requirement.

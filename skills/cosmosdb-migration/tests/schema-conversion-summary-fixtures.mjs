export const VALID_DOMAIN_SUMMARY = `# Orders Schema Conversion

## Overview
Complete domain design.

## Tables to Container Mapping
Orders maps to Orders.

## Container Summary
One container with an order docType.

\`\`\`json
${JSON.stringify({ id: 'order-1', docType: 'order' }, null, 2)}
\`\`\`

\`\`\`json
${JSON.stringify({ id: 'item-1', docType: 'item' }, null, 2)}
\`\`\`

## Partition Key Decisions
Uses /tenantId.

## Embedding Strategy
Order lines are embedded.

## Access Pattern Mappings
R001 maps to a partition-routed point read.

## Cross-Partition Queries
None accepted.

## Indexing Policies
Only queried paths are indexed.

## Optimization Recommendations
Use point reads.

## Throughput & Storage Recommendations
Inputs: [volumetrics] [access patterns]
`;

export const VALID_ROOT_SUMMARY = `# Migration Database

## Database Overview
migration-db contains one container.

## Container Inventory
Orders.

## Container Mappings
Orders maps Sales.Orders.

## Cross-Domain Relationships
None.

## Conflict Resolutions
No conflicts.

## Deployment Notes
Serverless is eligible.

## Per-Domain References
[Orders](./domains/Orders/summary.md)
`;

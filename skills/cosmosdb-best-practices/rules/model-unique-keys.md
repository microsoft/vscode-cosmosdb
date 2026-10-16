---
title: Enforce Uniqueness Within the Correct Partition Scope
impact: CRITICAL
impactDescription: prevents duplicate business keys without claiming global or relational guarantees
tags: model, unique-keys, uniqueness, constraints, partitioning, data-integrity
---

## Enforce Uniqueness Within the Correct Partition Scope

Use a native `uniqueKeyPolicy` when the required business-key uniqueness fits one
logical partition. The service atomically rejects conflicting creates and updates.
A query or existence check followed by a write is not race-safe enforcement, and
ETags on separate items do not enforce uniqueness between those items.

**Incorrect (application-only duplicate check):**

```typescript
const existing = await findCustomerByEmail(customer.tenantId, customer.email);
if (!existing) {
    await container.items.create(customer);
}
```

Two concurrent requests can both observe no match and insert different IDs with
the same email. Unique item IDs alone do not protect a separate business key.

**Correct (native email uniqueness within each tenant):**

For an authorized new container, configure the policy at creation time. This
example uses an existing authenticated SDK client through its database handle.
Run container creation once, separately from customer writes.

```typescript
import type { Container, Database } from '@azure/cosmos';

export async function createCustomerContainer(database: Database): Promise<Container> {
    const { container } = await database.containers.create({
        id: 'Customers',
        partitionKey: { paths: ['/tenantId'] },
        uniqueKeyPolicy: {
            uniqueKeys: [{ paths: ['/email'] }],
        },
    });
    return container;
}

export async function addCustomer(
    container: Container,
    customer: { id: string; tenantId: string; email: string },
): Promise<void> {
    try {
        await container.items.create(customer);
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 409) {
            throw new Error('Customer ID or email conflicts within this tenant.', { cause: error });
        }
        throw error;
    }
}
```

Both item-ID conflicts and unique-key violations can return HTTP 409. Treat this
as a conflict, not a transient failure to retry blindly. Do not silently switch to
upsert, generate another ID, or remove the constraint to bypass it.

### Scope and Comparison Semantics

- Uniqueness applies within the full logical partition-key value. With hierarchical
  keys, it applies to the complete tuple, not just a leading prefix. The same email
  can exist in different tenants in the example; this is not global uniqueness.
- Paths and string values are case-sensitive. `/email` differs from `/Email`, and
  `Alice@example.com` differs from `alice@example.com`. Do not assume SQL collation
  equivalence or that lowercasing reproduces source comparison semantics. Define and
  verify an explicit comparison contract before using a normalized business key.
- Missing paths participate as null; sparse unique keys are not supported. Multiple
  items with a missing or null value can collide within the same logical partition.
- Each entry in `uniqueKeys` is a separate constraint. Multiple paths in one entry,
  such as `{ "paths": ["/firstName", "/lastName"] }`, constrain the combination,
  not each property independently. For composite keys, the entire value tuple,
  including null components, determines a collision.
- Policies apply to every document type in the container, with no implicit `docType`
  isolation or SQL-style filtered constraints. Adding `/docType` to a composite key
  scopes uniqueness by type, but still permits only one all-null business-key tuple
  per type and logical partition. Check every co-located type before choosing this
  design; use separate containers when their constraint requirements are incompatible.

### Creation and Verification

- Define `uniqueKeyPolicy` on the container, not inside `indexingPolicy`. Ordinary
  range and composite indexes do not enforce uniqueness.
- A policy supports at most 10 unique-key constraints and 16 total path values.
  Nested property paths such as `/address/zipCode` are supported.
- Policies are immutable after container creation. Inspect existing policies before
  seeding; `createIfNotExists` does not retrofit a missing policy. A mismatch requires
  an approved new-container and data-migration plan, not an in-place policy update
  or automatic deletion/recreation.
- Read back the policy and test conflicting writes within one partition, allowed
  duplicates across partitions, case differences, and missing/null values. Check
  existing data for collisions before importing it. Unique keys slightly increase
  write RU charges; measure with representative writes.
- Native unique keys do not enforce foreign keys, cascades, or cross-partition
  transactions. If the required uniqueness exceeds their scope, evaluate a different
  partitioning or enforcement design explicitly; do not silently weaken the guarantee
  or assume a reservation document alone makes a multi-partition workflow atomic.

References:
- [Unique keys in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/unique-keys)
- [Define unique keys with SDKs](https://learn.microsoft.com/azure/cosmos-db/how-to-define-unique-keys)
- [Cosmos DB JavaScript SDK](https://learn.microsoft.com/javascript/api/@azure/cosmos/)

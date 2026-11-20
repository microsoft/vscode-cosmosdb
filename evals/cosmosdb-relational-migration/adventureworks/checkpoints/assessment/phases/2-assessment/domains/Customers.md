# Customers Domain

## Purpose

**Representative aggregate root:** SalesLT.Customer. Customer and Address are separate shared source records; the
CustomerAddress relationship is not proof of one aggregate or atomic multi-record update. This domain owns the address
reference for both customer associations and order billing/shipping references. It does not own order-specific state.

The strongest evidence is the [source inventory](../../1-discovery/preflight-manifest.json) and customer controller:
CustomerAddress has FKs to Customer and Address, and SalesOrderHeader has two distinct address FKs. Grouping address
with the customer association gives it one owner without duplicating it per order. An Address-only domain is plausible
if a separate enterprise address lifecycle is established; there is no such evidence here. Unexamined consumers,
sharing frequency, lifecycle and actual cardinalities remain unknown.

## Tables

| Table | Source key | EF mapping versus access |
|---|---|---|
| SalesLT.Customer | CustomerID | Mapped; customer controller reads and creates/updates/deletes. |
| SalesLT.Address | AddressID | Mapped; no controller access found; shared reference, including for orders. |
| SalesLT.CustomerAddress | (CustomerID, AddressID) | Mapped; no controller access found; retain both key components and relationship. |

EF mapping is evidenced by [sampledbContext](../../../../Models/sampledbContext.cs); no observed controller access is not
proof that other applications do not use Address or CustomerAddress.

## Access Patterns

- R001 lists all customers, R002 looks up a customer by ID, and W001-W003 create, update and delete customers.
  [Customer controller](../../../../Controllers/CustomersController.cs); frequencies and latency are unknown.
- No source pattern was found for Address or CustomerAddress; their FKs and data remain in scope.
  [Discovery report](../../1-discovery/discovery-report.md).

## Cross-Domain Dependencies

Orders consumes Customer through SalesOrderHeader.CustomerID and consumes the same Address owner separately through
BillToAddressID and ShipToAddressID. These are three distinct SQL `NO ACTION` relationships. Customer deletion W003
must account for incoming SalesOrderHeader and CustomerAddress restrictions; deleting an address must respect both
order references and CustomerAddress. Reference resolution and enforcement across any future boundary remain to be
designed; IDs or stale copies alone do not preserve referential integrity.

## Preliminary Recommendations

Keep all source IDs, Address and the ordered CustomerAddress composite key; preserve NOT NULL, rowguid uniqueness,
defaults and incoming delete restrictions. Assess reference hydration versus bounded copies after measuring access and
consistency needs (`rules/model-relationship-references.md`, `rules/model-embed-related.md`). SQL-wide uniqueness and
collation are not automatically equivalent to partition-local unique keys (`rules/model-unique-keys.md`). No container,
partition, transactional implementation, or data duplication is selected here.

## Estimated Tokens: 111280

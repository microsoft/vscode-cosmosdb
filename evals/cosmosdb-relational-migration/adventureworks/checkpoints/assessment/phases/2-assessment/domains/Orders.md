# Orders Domain

## Purpose

**Representative aggregate root:** SalesLT.SalesOrderHeader. The order header and detail are grouped around their
source FK and explicit header-delete cascade, not because a multi-row atomic operation was observed in the application.
The [source inventory](../../1-discovery/preflight-manifest.json) establishes the relationship; the current controllers
do not establish an order workflow or its cardinalities. A standalone detail analysis unit could be useful if sizes or
independent lifecycle require it, but treating the cascade as unrelated or dropping the tables would lose source semantics.

## Tables

| Table | Source key | EF mapping versus access |
|---|---|---|
| SalesLT.SalesOrderHeader | SalesOrderID | Mapped; no controller access found; sequence-backed key and computed order number/total. |
| SalesLT.SalesOrderDetail | (SalesOrderID, SalesOrderDetailID) | Mapped; no controller access found; retain both ordered key parts and computed LineTotal. |

EF mappings are in [sampledbContext](../../../../Models/sampledbContext.cs). The absence of an order controller does
not establish absence of other consumers. The sequence schema and computed SQL metadata require future verification.

## Access Patterns

No application reads or writes for either table were found in [discovery](../../1-discovery/discovery-report.md).
The SQL FK and cascade are schema evidence, not an observed order-delete operation or transaction.

## Cross-Domain Dependencies

SalesOrderHeader.CustomerID references Customers.Customer; BillToAddressID and ShipToAddressID independently reference
the single Customers.Address owner. SalesOrderDetail.ProductID references Catalog.Product. All four FKs have SQL
`NO ACTION`. Preserve the two address roles distinctly and preserve referenced-key identity and delete restrictions.
Whether historical orders require snapshots, how consistency is maintained, and how cross-boundary checks are enforced
are unresolved; do not assume eventual propagation provides SQL atomicity.

Within Orders, deleting a SalesOrderHeader cascades to its SalesOrderDetail rows. Preserve that source behavior,
including completeness under failures and concurrency, without assuming that one domain is one target transaction.
Child count distributions and any actual coordinated writes are unknown.

## Preliminary Recommendations

Retain the ordered detail composite key, sequence semantics, computed fields, money precision, source defaults, and
the header-to-detail cascade. Assess independent versus read-together relationships only after measuring child sizes,
consistency and access (`rules/model-reference-large.md`, `rules/model-embed-related.md`,
`rules/model-relationship-references.md`). `rules/model-numeric-precision.md` and `rules/model-avoid-2mb-limit.md`
identify precision and MAX-comment risks. No ownership, partition, embedding or cascade implementation for a target
is selected.

## Estimated Tokens: 109507

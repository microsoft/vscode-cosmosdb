# Discovery Report

## Source Overview

[Preflight](preflight-summary.md) inventories the authoritative, immutable [SQL Server DDL](schema-ddl/AdventureworksLT.sql)
and its exact source locations. [AdventureWorks.Web](../../../AdventureWorks.Web.csproj) is ASP.NET Core MVC 2.1,
targeting `netcoreapp2.1`, using C# and EF Core's SQL Server provider configured in [Startup.cs](../../../Startup.cs).
[sampledbContext](../../../Models/sampledbContext.cs) exposes all 12 DDL tables, including the two default-schema
`dbo` entities. SQL bracket quoting and GO batches were interpreted directly; there was no source-engine execution.

| Schema | Tables | Application coverage |
|---|---|---|
| dbo | BuildVersion, ErrorLog | No application reads or writes found. |
| SalesLT | Address, CustomerAddress | No application reads or writes found; referenced by relationships. |
| SalesLT | Customer | Controller reads and writes. |
| SalesLT | Product, ProductCategory | Controller reads and writes. |
| SalesLT | ProductModel | Read in product includes and selection lists. |
| SalesLT | ProductDescription, ProductModelProductDescription | No application reads or writes found. |
| SalesLT | SalesOrderDetail, SalesOrderHeader | No application reads or writes found; source cascade and computed values remain in scope. |

No observed application access means no access found in the inspected code, not proof of no other clients or production
activity. The [synthetic workload](volumetrics/workload.json) assumes 1,000 rows, 2 KB, 5% monthly growth, 1 read TPS,
and 0.1 write TPS for each table; these are not measurements. BuildVersion's 1,000 rows are impossible for a unique
TINYINT key, so its feasible count is unknown. Estimated 2 KB does not bound binary, XML or MAX text. Peak windows,
percentiles, retention, skew, regional requirements, latency and actual operation counts are unknown.

Offline SDK matrix: C# has a stable first-party .NET SDK family, `Microsoft.Azure.Cosmos`. This is a language-level
classification, not proof that a particular SDK release supports this old `netcoreapp2.1` application, its dependencies,
or all later target features; verify compatibility and support before any future code migration. No SDK was installed
and no external documentation or service was accessed.

## Read Patterns

All frequencies and latency requirements below are unknown; per-table synthetic TPS cannot be assigned to these patterns.
All result sizes are unmeasured. No explicit ordering is present in any listed query.

| ID | Static code evidence | Scope and implications |
|---|---|---|
| R001 | [CustomersController:22-25](../../../Controllers/CustomersController.cs#L22-L25) | `Customer.ToListAsync()` reads all customers, no filtering or paging. |
| R002 | [CustomersController:28-38, 68-75, 120-149](../../../Controllers/CustomersController.cs#L28-L38) | Details/delete preview use `FirstOrDefaultAsync(CustomerId)`; edit/delete use `FindAsync`; an update exception can cause `Any` by ID. Individual lookup; no related entities loaded. |
| R003 | [ProductCategoriesController:22-25](../../../Controllers/ProductCategoriesController.cs#L22-L25) | `ProductCategory.Include(ParentProductCategory).ToListAsync()` is an unbounded list with self-relation. |
| R004 | [ProductCategoriesController:28-40, 72-84, 125-156](../../../Controllers/ProductCategoriesController.cs#L28-L40) | Category ID lookup; detail/delete preview include parent; edit/delete use `FindAsync`, and update exception can invoke `Any`. |
| R005 | [ProductCategoriesController:48-50, 67, 84, 120](../../../Controllers/ProductCategoriesController.cs#L48-L50) | Unfiltered parent-category `SelectList` on forms and failed validation, selected by ID; materialization occurs through MVC/view enumeration. |
| R006 | [ProductsController:22-25](../../../Controllers/ProductsController.cs#L22-L25) | Unbounded product list includes optional category and model; actual SQL shape and execution were not observed. |
| R007 | [ProductsController:28-42, 75-88, 130-162](../../../Controllers/ProductsController.cs#L28-L42) | Product ID lookup; detail/delete preview include category and model, while edit/delete find only product and an update exception can call `Any`. |
| R008 | [ProductsController:49-52, 69-70, 87-88, 124-125](../../../Controllers/ProductsController.cs#L49-L52) | Separate unfiltered category and model `SelectList` queries for create/edit and validation failures. |

The [reviewed access template](access-patterns/access-patterns.md) contains exact evidence and dispositions. Read-together
relationships and unbounded lists are evidence to assess, not a decision to embed, partition or change UI pagination.

## Write Patterns

The three scaffolded controllers each bind posted fields, check `ModelState`, add or attach/update a single entity, and
call `SaveChangesAsync`. Deletes first use `FindAsync`, then `Remove` and `SaveChangesAsync`. No explicit transaction or
batch spanning entities is shown; actual provider transaction behavior and database execution were not observed.

| ID | Operation | Static evidence |
|---|---|---|
| W001 | Create Customer | [CustomersController:55-63](../../../Controllers/CustomersController.cs#L55-L63) |
| W002 | Update Customer | [CustomersController:86-112](../../../Controllers/CustomersController.cs#L86-L112) |
| W003 | Delete Customer | [CustomersController:138-144](../../../Controllers/CustomersController.cs#L138-L144) |
| W004 | Create ProductCategory | [ProductCategoriesController:58-65](../../../Controllers/ProductCategoriesController.cs#L58-L65) |
| W005 | Update ProductCategory | [ProductCategoriesController:91-118](../../../Controllers/ProductCategoriesController.cs#L91-L118) |
| W006 | Delete ProductCategory | [ProductCategoriesController:145-151](../../../Controllers/ProductCategoriesController.cs#L145-L151) |
| W007 | Create Product | [ProductsController:60-67](../../../Controllers/ProductsController.cs#L60-L67) |
| W008 | Update Product | [ProductsController:95-122](../../../Controllers/ProductsController.cs#L95-L122) |
| W009 | Delete Product | [ProductsController:151-157](../../../Controllers/ProductsController.cs#L151-L157) |

Updates attach the posted object via `Update`; the controller catches `DbUpdateConcurrencyException` and checks existence,
but no rowversion or explicit concurrency-token configuration appears in the inspected mapping. The catch alone does not
establish lost-update protection. Submitted values, server defaults and EF value-generation behavior need runtime
verification before promising equivalent writes.

## Relational Semantics

The [preflight manifest](preflight-manifest.json) inventories all columns, ordered composite keys, 12 named foreign keys,
27 ordered explicit indexes, six alias definitions, defaults, computed expressions, sequence and line-level provenance.
Database constraints are treated as source obligations, not target implementations.

- **W001-W003 Customer:** SQL Server enforces PK, required and length constraints and unique `rowguid`; `newid()` and
  `getdate()` are defaults, `NameStyle` defaults to 0. EF configures required names and hash/salt, lengths, and some
  generated defaults. The controller checks ModelState but does not itself enforce the DB uniqueness or incoming FKs.
  W003 is subject to `NO ACTION` references from CustomerAddress and SalesOrderHeader.
- **W004-W006 ProductCategory:** SQL Server enforces PK, required name, unique Name and rowguid, and the optional
  self-reference; default GUID/time generation is database-side. EF maps the relationship and unique indexes; ModelState
  is checked on create/update. W006 is restricted by incoming Product and child-category `NO ACTION` relationships.
- **W007-W009 Product:** SQL Server enforces PK, required/length and numeric constraints, unique Name, ProductNumber
  and rowguid, and optional Category/Model FKs. EF maps lengths, money, decimal(8,2), relationships and unique indexes;
  ModelState is checked on create/update. W009 is restricted by the SalesOrderDetail product FK. SQL Server remains
  the enforcing authority for the declared constraints; controllers do not explicitly validate all relationships or
  uniqueness. No declared CHECK constraint supplements those type constraints.
- All W001-W009 rely on a single SaveChanges call and database constraint outcomes; transactional and concurrency
  equivalence must be evaluated later. SQL Server `IDENTITY`, `newid()` and `getdate()` behavior is not a target
  identity, clock or retry design. `rowguid` is a generated unique identifier, not a rowversion concurrency token.
- SalesOrderHeader ID defaults to the `SalesLT.SalesOrderNumber` sequence; its order number and total due are computed.
  SalesOrderDetail has a composite key and computed LineTotal; deleting a header cascades to details. Other listed FKs
  have implicit NO ACTION. No order controller is present, but these semantics remain in migration scope.
- DDL declares alias types and explicit column nullability; computed-column exact SQL-derived types and nullability are
  not independently verified. EF maps LineTotal as numeric(38,6), TotalDue as money, and SalesOrderNumber as length 25.
  `SalesOrderHeader.OnlineOrderFlag` is `bool?` in the CLR class but explicitly `.IsRequired()` in EF and NOT NULL in DDL.
  EF registers an unqualified `HasSequence<int>("SalesOrderNumber")` while the source DDL and SQL default specify the
  SalesLT schema; verify EF default-schema behavior rather than treating the two as proven identical.
- No triggers, procedures, views or CHECK constraints are declared in the selected DDL. Existing database objects outside
  that file and the actual server collation remain unknown. The workload collation is a synthetic assumption.

## Warnings

- **Assurance:** model-reviewed and structurally evidence-validated only; neither validates SQL on SQL Server, actual
  deployed schema, application runtime behavior, production load, or cloud behavior. No parser, application execution,
  database connection, dependency installation or Azure call occurred.
- **Sensitive fields:** customer views display and accept the password hash and salt, as shown by
  [index](../../../Views/Customers/Index.cshtml#L46-L49) and
  [create](../../../Views/Customers/Create.cshtml#L68-L75). Preserve data access semantics for analysis while treating
  exposure and access controls as a separate review obligation; no credential values were accessed.
- **Size and precision:** Product photo `VARBINARY(MAX)`, ProductModel XML and order comment `NVARCHAR(MAX)` can exceed
  the synthetic average; MONEY and computed numeric values require exactness analysis. Collect real distributions before
  any sizing or representation decision.
- **Applied peer guidance:** `rules/model-embed-related.md` highlights product/category/model read correlation without
  choosing embedding; `rules/partition-query-patterns.md` highlights key versus list access without choosing a partition;
  `rules/query-pagination.md` flags unbounded lists; `rules/sdk-etag-concurrency.md` identifies update-concurrency
  verification; `rules/model-numeric-precision.md` and `rules/model-avoid-2mb-limit.md` identify monetary precision and
  large-value risks; `rules/sdk-dotnet-cosmos-package-id.md` identifies the supported .NET package. These are discovery
  concerns, not approved target designs or claims of measured savings.

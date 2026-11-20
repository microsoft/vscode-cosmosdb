# Catalog Domain

## Purpose

**Representative aggregate root:** SalesLT.Product. ProductCategory and ProductModel are independently referenced
catalog records, not automatically embedded in Product; descriptions and their culture association form additional
catalog structures. The source ownership grouping follows the catalog lifecycle and FK graph rather than claiming
one transaction across the domain.

The [source inventory](../../1-discovery/preflight-manifest.json) establishes Product's category/model FKs and the
model/description association. The [product controller](../../../../Controllers/ProductsController.cs) reads category
and model together with products; [category controller](../../../../Controllers/ProductCategoriesController.cs) writes
categories independently. Separate product and reference-data domains would be plausible if independent business
owners are established; merely seeing joins is not evidence for multiple owners, and actual ownership and update
frequency remain unverified. Orders consumes Product without becoming a catalog owner.

## Tables

| Table | Source key | EF mapping versus access |
|---|---|---|
| SalesLT.Product | ProductID | Mapped; product controller reads and creates/updates/deletes. |
| SalesLT.ProductCategory | ProductCategoryID | Mapped; category controller reads and writes; product controller reads. |
| SalesLT.ProductModel | ProductModelID | Mapped; product controller reads through includes and selection lists. |
| SalesLT.ProductDescription | ProductDescriptionID | Mapped; no controller access found. |
| SalesLT.ProductModelProductDescription | (ProductModelID, ProductDescriptionID, Culture) | Mapped; no controller access found; preserve all three ordered components. |

## Access Patterns

R003-R005 cover category lists, ID lookup, parent include and parent selection. R006-R008 cover product list and key
reads with category/model includes and unpaged selection lists; R007's edit/delete key-only lookup does not itself
include both relationships. W004-W006 affect categories and W007-W009 affect products. See
[discovery](../../1-discovery/discovery-report.md) for precise controller links, paths, conditions and unknown TPS.
No application access was found for ProductDescription or ProductModelProductDescription.

## Cross-Domain Dependencies

Orders.SalesOrderDetail.ProductID refers to this domain's Product, with SQL `NO ACTION` on product deletion. The
ProductCategory.ParentProductCategoryID self-FK stays within Catalog, with SQL `NO ACTION` and an optional parent;
R003/R004 load that parent. Product's category and model FKs and both model-description FKs are also internal and
must not be lost. Cross-domain FK enforcement and consumers must be resolved later; ownership is not duplicated.

## Preliminary Recommendations

Retain source names/IDs, all composite-key parts, unique Product.Name, Product.ProductNumber, ProductCategory.Name,
ProductModel.Name and rowguid constraints under the actual SQL comparison semantics; source collation remains unknown.
Evaluate list pagination and related-record hydration versus duplication using `rules/query-pagination.md`,
`rules/model-relationship-references.md`, `rules/model-embed-related.md`, and `rules/model-unique-keys.md`.
Product binary MAX and model XML have unknown size distributions (`rules/model-avoid-2mb-limit.md`); MONEY and
DECIMAL require exactness (`rules/model-numeric-precision.md`). No target representation is selected.

## Estimated Tokens: 114162

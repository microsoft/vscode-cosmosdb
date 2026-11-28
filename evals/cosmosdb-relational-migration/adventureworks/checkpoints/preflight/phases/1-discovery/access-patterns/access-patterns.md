# Access Patterns

All patterns below are statically code-evidenced, not runtime observations. Frequencies and latency requirements are unknown.

## Read Patterns

| # | Pattern Name | Tables / Entities | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes |
|---:|---|---|---|---:|---|---|
| R001 | List customers | SalesLT.Customer | none | unknown | unknown | ToListAsync, no ordering or pagination; Controllers/CustomersController.cs:22-25. |
| R002 | Customer by key and existence | SalesLT.Customer | CustomerID | unknown | unknown | Details and delete preview use FirstOrDefaultAsync; edit/delete use FindAsync; concurrency handling uses Any; Controllers/CustomersController.cs:28-38, 68-75, 120-149. |
| R003 | List categories with parent | SalesLT.ProductCategory | none; parent via ParentProductCategoryID | unknown | unknown | Include parent and ToListAsync, no ordering or pagination; Controllers/ProductCategoriesController.cs:22-25. |
| R004 | Category by key with parent | SalesLT.ProductCategory | ProductCategoryID; parent via ParentProductCategoryID | unknown | unknown | Details/delete preview include parent; edit/delete lookup and existence checks also by key; Controllers/ProductCategoriesController.cs:28-40, 72-84, 125-156. |
| R005 | Category parent selection | SalesLT.ProductCategory | none; selected ParentProductCategoryID | unknown | unknown | Unpaged SelectList on create/edit and validation errors; Controllers/ProductCategoriesController.cs:48-50, 67, 84, 120. |
| R006 | List products with category and model | SalesLT.Product, SalesLT.ProductCategory, SalesLT.ProductModel | none; ProductCategoryID and ProductModelID relationships | unknown | unknown | Include both and ToListAsync, no ordering or pagination; Controllers/ProductsController.cs:22-25. |
| R007 | Product by key with relationships | SalesLT.Product, SalesLT.ProductCategory, SalesLT.ProductModel | ProductID; ProductCategoryID and ProductModelID relationships | unknown | unknown | Details/delete preview include both; edit/delete and existence checks find product by key; Controllers/ProductsController.cs:28-42, 75-88, 130-162. |
| R008 | Product category and model selection | SalesLT.ProductCategory, SalesLT.ProductModel | none; selected ProductCategoryID and ProductModelID | unknown | unknown | Unpaged SelectList on create/edit and validation errors; Controllers/ProductsController.cs:49-52, 69-70, 87-88, 124-125. |

## Write Patterns

| # | Pattern Name | Tables / Entities | Single / Batch | Frequency (TPS) | Latency Requirement | Notes |
|---:|---|---|---|---:|---|---|
| W001 | Create customer | SalesLT.Customer | single entity | unknown | unknown | ModelState then Add and SaveChangesAsync; Controllers/CustomersController.cs:55-63. |
| W002 | Update customer | SalesLT.Customer | single entity | unknown | unknown | Detached Update after ID check; SaveChangesAsync; concurrency exception invokes existence check; Controllers/CustomersController.cs:86-112. |
| W003 | Delete customer | SalesLT.Customer | single entity after lookup | unknown | unknown | FindAsync, Remove, SaveChangesAsync; Controllers/CustomersController.cs:138-144. |
| W004 | Create category | SalesLT.ProductCategory | single entity | unknown | unknown | ModelState then Add and SaveChangesAsync; Controllers/ProductCategoriesController.cs:58-65. |
| W005 | Update category | SalesLT.ProductCategory | single entity | unknown | unknown | Detached Update after ID check; SaveChangesAsync; concurrency exception invokes existence check; Controllers/ProductCategoriesController.cs:91-118. |
| W006 | Delete category | SalesLT.ProductCategory | single entity after lookup | unknown | unknown | FindAsync, Remove, SaveChangesAsync; Controllers/ProductCategoriesController.cs:145-151. |
| W007 | Create product | SalesLT.Product | single entity | unknown | unknown | ModelState then Add and SaveChangesAsync; Controllers/ProductsController.cs:60-67. |
| W008 | Update product | SalesLT.Product | single entity | unknown | unknown | Detached Update after ID check; SaveChangesAsync; concurrency exception invokes existence check; Controllers/ProductsController.cs:95-122. |
| W009 | Delete product | SalesLT.Product | single entity after lookup | unknown | unknown | FindAsync, Remove, SaveChangesAsync; Controllers/ProductsController.cs:151-157. |

## Additional Notes

No observed application access: dbo.BuildVersion

No observed application access: dbo.ErrorLog

No observed application access: SalesLT.Address

No observed application access: SalesLT.CustomerAddress

No observed application access: SalesLT.ProductDescription

No observed application access: SalesLT.ProductModelProductDescription

No observed application access: SalesLT.SalesOrderDetail

No observed application access: SalesLT.SalesOrderHeader

These dispositions mean no access found in the inspected application code, not that no external client uses the tables.
Each controller invokes SaveChanges for one submitted entity; no explicit cross-request or multi-entity transaction is
declared. SQL Server and EF execution details were not observed.

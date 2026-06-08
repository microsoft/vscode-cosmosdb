/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getAccessPatternsTemplateContent(): string {
    return `# Access Patterns

> Fill in the tables below with the known access patterns for your application.
> This information helps the migration assistant design optimal Cosmos DB containers
> and partition strategies.
>
> **Tip:** This file is treated as the primary source for access patterns during analysis.
> You can also provide additional files alongside this template.
>
> **TPS** = Transactions Per Second — the estimated number of times this pattern is executed per second under normal load.

## Read Patterns

| #    | Pattern Name             | Tables / Entities  | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes                                          |
|-----:|--------------------------|--------------------|------------------------|----------------:|---------------------|------------------------------------------------|
| R001 | Get order by ID          | Orders, OrderItems | OrderId                |             200 | < 10 ms             | example; point read, most latency-sensitive    |
| R002 | List orders by customer  | Orders, Customers  | CustomerId, OrderDate  |             150 | < 50 ms             | example; paginated, sorted by date descending  |
| R003 | Search products          | Products           | Name, Category         |             500 | < 200 ms            | example; supports autocomplete and filtering   |

## Write Patterns

| #    | Pattern Name             | Tables / Entities  | Single / Batch | Frequency (TPS) | Latency Requirement | Notes                                          |
|-----:|--------------------------|--------------------|----------------|----------------:|---------------------|------------------------------------------------|
| W001 | Place new order          | Orders, OrderItems | Batch          |             100 | < 100 ms            | example; transactional, inserts multiple items |
| W002 | Update order status      | Orders             | Single         |              80 | < 50 ms             | example; partial update on single field        |
| W003 | Delete expired sessions  | Sessions           | Batch          |              10 | < 200 ms            | example; scheduled batch cleanup via TTL       |

## Additional Notes

<!-- Add any extra context about access patterns, batch operations, reporting queries, etc. -->
`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseCodeEvidencedTables } from './phase1Discovery';

describe('parseCodeEvidencedTables', () => {
    it('returns empty array for empty input', () => {
        expect(parseCodeEvidencedTables('')).toEqual([]);
    });

    it('returns empty array when no table rows have markdown links', () => {
        const md = `# Access Patterns

## Read Patterns

| #    | Pattern Name        | Tables / Entities | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes              |
|-----:|---------------------|-------------------|------------------------|----------------:|---------------------|--------------------|
| R001 | Get order by ID     | Orders            | OrderId                |             200 | < 10 ms             | point read         |
| R002 | List by customer    | Orders, Customers | CustomerId             |             150 | < 50 ms             | paginated          |`;

        expect(parseCodeEvidencedTables(md)).toEqual([]);
    });

    it('extracts tables from rows with markdown links', () => {
        const md = `| #    | Pattern Name        | Tables / Entities      | Filter       | TPS | Latency  | Notes                                           |
|-----:|---------------------|------------------------|--------------|----:|----------|-------------------------------------------------|
| R001 | Get order by ID     | Orders, OrderItems     | OrderId      | 200 | < 10 ms  | [OrderRepo.ts](../../src/repos/OrderRepo.ts)    |
| R002 | List customers      | Customers              | Name         | 100 | < 50 ms  | no code ref                                     |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders', 'OrderItems']);
    });

    it('deduplicates table names across multiple rows', () => {
        const md = `| R001 | Get order       | Orders, OrderItems | OrderId    | 200 | < 10 ms | [Repo.ts](../../src/Repo.ts)       |
| R002 | Search orders   | Orders             | Status     | 150 | < 50 ms | [Search.ts](../../src/Search.ts)   |
| W001 | Insert order    | Orders, OrderItems | OrderId    | 100 | < 100ms | [Writer.ts](../../src/Writer.ts)   |`;

        const result = parseCodeEvidencedTables(md);
        expect(result).toContain('Orders');
        expect(result).toContain('OrderItems');
        expect(result.filter((t) => t === 'Orders')).toHaveLength(1);
    });

    it('ignores header separator rows', () => {
        const md = `| # | Name | Tables | Notes |
|---|------|--------|-------|
| R001 | Get order | Orders | [Repo.ts](src/Repo.ts) |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders']);
    });

    it('ignores rows without valid pattern IDs', () => {
        const md = `| total | Summary | Orders, Products | [link](file.ts) |`;

        expect(parseCodeEvidencedTables(md)).toEqual([]);
    });

    it('handles write patterns', () => {
        const md = `| W001 | Insert order | Orders, OrderItems | [Writer.ts](../../src/Writer.ts) |
| W002 | Update stock | Products | no link |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders', 'OrderItems']);
    });

    it('handles markdown links anywhere in the row', () => {
        const md = `| R001 | [Get order](docs/patterns.md) | Orders | [Repo.ts](src/Repo.ts) |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders']);
    });

    it('trims whitespace from table names', () => {
        const md = `| R001 | Get order | Orders ,  OrderItems , Customers | OrderId | 200 | < 10ms | [Repo.ts](src/Repo.ts) |`;

        const result = parseCodeEvidencedTables(md);
        expect(result).toEqual(['Orders', 'OrderItems', 'Customers']);
    });
});

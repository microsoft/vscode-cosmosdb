/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildDependencyGraph,
    extractSchemaGroups,
    formatSchemaGroups,
    getSubgraphForTables,
    parseQualifiedName,
    qualifiedTableName,
    serializeGraphForPrompt,
} from './dependencyGraph';

describe('parseQualifiedName', () => {
    it('parses bare table name', () => {
        expect(parseQualifiedName('Orders')).toEqual({ name: 'Orders' });
    });

    it('parses schema.table', () => {
        expect(parseQualifiedName('Person.Address')).toEqual({ schema: 'Person', name: 'Address' });
    });

    it('parses [Schema].[Table] (SQL Server)', () => {
        expect(parseQualifiedName('[Person].[Address]')).toEqual({ schema: 'Person', name: 'Address' });
    });

    it('parses "schema"."table" (PostgreSQL/Oracle)', () => {
        expect(parseQualifiedName('"public"."users"')).toEqual({ schema: 'public', name: 'users' });
    });

    it('parses `schema`.`table` (MySQL)', () => {
        expect(parseQualifiedName('`mydb`.`orders`')).toEqual({ schema: 'mydb', name: 'orders' });
    });

    it('parses bare quoted table without schema', () => {
        expect(parseQualifiedName('[Orders]')).toEqual({ name: 'Orders' });
    });
});

describe('qualifiedTableName', () => {
    it('returns bare name when no schema', () => {
        expect(qualifiedTableName({ name: 'Orders', columns: [] })).toBe('Orders');
    });

    it('returns schema.name when schema present', () => {
        expect(qualifiedTableName({ name: 'Address', schema: 'Person', columns: [] })).toBe('Person.Address');
    });
});

describe('buildDependencyGraph', () => {
    it('parses unqualified CREATE TABLE', () => {
        const ddl = `
            CREATE TABLE Orders (
                OrderID INT PRIMARY KEY,
                CustomerID INT,
                OrderDate DATE
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(1);
        expect(graph.tables[0].name).toBe('Orders');
        expect(graph.tables[0].schema).toBeUndefined();
        expect(graph.tables[0].columns).toEqual(['OrderID', 'CustomerID', 'OrderDate']);
    });

    it('parses SQL Server schema-qualified CREATE TABLE with brackets', () => {
        const ddl = `
            CREATE TABLE [Person].[Address] (
                AddressID INT PRIMARY KEY,
                City NVARCHAR(100),
                StateProvinceID INT
            );
            CREATE TABLE [Person].[StateProvince] (
                StateProvinceID INT PRIMARY KEY,
                Name NVARCHAR(100)
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(2);
        expect(graph.tables[0].name).toBe('Address');
        expect(graph.tables[0].schema).toBe('Person');
        expect(graph.tables[1].name).toBe('StateProvince');
        expect(graph.tables[1].schema).toBe('Person');
    });

    it('parses PostgreSQL schema-qualified CREATE TABLE with double quotes', () => {
        const ddl = `
            CREATE TABLE "public"."users" (
                id SERIAL PRIMARY KEY,
                email TEXT
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(1);
        expect(graph.tables[0].name).toBe('users');
        expect(graph.tables[0].schema).toBe('public');
    });

    it('parses MySQL schema-qualified CREATE TABLE with backticks', () => {
        const ddl = `
            CREATE TABLE \`mydb\`.\`orders\` (
                id INT PRIMARY KEY,
                total DECIMAL(10,2)
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(1);
        expect(graph.tables[0].name).toBe('orders');
        expect(graph.tables[0].schema).toBe('mydb');
    });

    it('parses dotted schema.table without quotes', () => {
        const ddl = `
            CREATE TABLE Sales.Customer (
                CustomerID INT PRIMARY KEY,
                Name VARCHAR(100)
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(1);
        expect(graph.tables[0].name).toBe('Customer');
        expect(graph.tables[0].schema).toBe('Sales');
    });

    it('parses inline FK with schema-qualified REFERENCES', () => {
        const ddl = `
            CREATE TABLE [Sales].[Order] (
                OrderID INT PRIMARY KEY,
                CustomerID INT REFERENCES [Person].[Customer](CustomerID)
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(1);
        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0]).toMatchObject({
            fromTable: 'Sales.Order',
            fromColumn: 'CustomerID',
            toTable: 'Person.Customer',
            toColumn: 'CustomerID',
        });
    });

    it('parses table-level FK with schema-qualified REFERENCES', () => {
        const ddl = `
            CREATE TABLE [Sales].[OrderDetail] (
                DetailID INT PRIMARY KEY,
                OrderID INT,
                ProductID INT,
                FOREIGN KEY (OrderID) REFERENCES [Sales].[Order](OrderID)
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0]).toMatchObject({
            fromTable: 'Sales.OrderDetail',
            fromColumn: 'OrderID',
            toTable: 'Sales.Order',
            toColumn: 'OrderID',
        });
    });

    it('parses ALTER TABLE with schema-qualified names', () => {
        const ddl = `
            CREATE TABLE [Person].[Address] (
                AddressID INT PRIMARY KEY,
                StateProvinceID INT
            );
            CREATE TABLE [Person].[StateProvince] (
                StateProvinceID INT PRIMARY KEY
            );
            ALTER TABLE [Person].[Address] ADD FOREIGN KEY (StateProvinceID) REFERENCES [Person].[StateProvince](StateProvinceID);
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0]).toMatchObject({
            fromTable: 'Person.Address',
            fromColumn: 'StateProvinceID',
            toTable: 'Person.StateProvince',
            toColumn: 'StateProvinceID',
        });
    });

    it('deduplicates tables with same schema.name', () => {
        const ddl = `
            CREATE TABLE [Sales].[Order] (OrderID INT);
            CREATE TABLE [Sales].[Order] (OrderID INT, Status INT);
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(1);
    });

    it('handles mixed qualified and unqualified tables', () => {
        const ddl = `
            CREATE TABLE [Person].[Address] (
                AddressID INT PRIMARY KEY
            );
            CREATE TABLE ErrorLog (
                ErrorLogID INT PRIMARY KEY
            );
        `;
        const graph = buildDependencyGraph(ddl);
        expect(graph.tables).toHaveLength(2);
        expect(graph.tables[0].schema).toBe('Person');
        expect(graph.tables[1].schema).toBeUndefined();
    });
});

describe('extractSchemaGroups', () => {
    it('groups tables by schema', () => {
        const graph = buildDependencyGraph(`
            CREATE TABLE [Person].[Address] (ID INT);
            CREATE TABLE [Person].[Email] (ID INT);
            CREATE TABLE [Sales].[Order] (ID INT);
            CREATE TABLE ErrorLog (ID INT);
        `);
        const groups = extractSchemaGroups(graph);
        expect(groups.get('Person')).toEqual(['Address', 'Email']);
        expect(groups.get('Sales')).toEqual(['Order']);
        expect(groups.get('')).toEqual(['ErrorLog']);
    });
});

describe('formatSchemaGroups', () => {
    it('returns empty string when all tables are unqualified', () => {
        const groups = new Map<string, string[]>([['', ['Orders', 'Customers']]]);
        expect(formatSchemaGroups(groups)).toBe('');
    });

    it('formats schema groups with counts', () => {
        const groups = new Map<string, string[]>([
            ['Person', ['Address', 'Email']],
            ['Sales', ['Order']],
        ]);
        const text = formatSchemaGroups(groups);
        expect(text).toContain('**Person** (2 tables)');
        expect(text).toContain('**Sales** (1 tables)');
    });

    it('labels unqualified tables when mixed with schemas', () => {
        const groups = new Map<string, string[]>([
            ['Person', ['Address']],
            ['', ['ErrorLog']],
        ]);
        const text = formatSchemaGroups(groups);
        expect(text).toContain('**(unqualified)** (1 tables)');
    });
});

describe('serializeGraphForPrompt', () => {
    it('includes schema groups section for schema-qualified tables', () => {
        const graph = buildDependencyGraph(`
            CREATE TABLE [Person].[Address] (ID INT);
            CREATE TABLE [Sales].[Order] (ID INT);
        `);
        const text = serializeGraphForPrompt(graph);
        expect(text).toContain('## Schema Groups');
        expect(text).toContain('**Person**');
        expect(text).toContain('**Sales**');
    });

    it('omits schema groups section for unqualified tables', () => {
        const graph = buildDependencyGraph(`
            CREATE TABLE Orders (ID INT);
        `);
        const text = serializeGraphForPrompt(graph);
        expect(text).not.toContain('## Schema Groups');
    });

    it('uses qualified table names in table list', () => {
        const graph = buildDependencyGraph(`
            CREATE TABLE [Person].[Address] (ID INT);
        `);
        const text = serializeGraphForPrompt(graph);
        expect(text).toContain('**Person.Address**');
    });
});

describe('getSubgraphForTables', () => {
    const graph = buildDependencyGraph(`
        CREATE TABLE [Person].[Address] (
            AddressID INT PRIMARY KEY,
            StateProvinceID INT
        );
        CREATE TABLE [Person].[StateProvince] (
            StateProvinceID INT PRIMARY KEY
        );
        CREATE TABLE [Sales].[Order] (
            OrderID INT PRIMARY KEY
        );
        ALTER TABLE [Person].[Address] ADD FOREIGN KEY (StateProvinceID) REFERENCES [Person].[StateProvince](StateProvinceID);
    `);

    it('matches by qualified name', () => {
        const sub = getSubgraphForTables(graph, ['Person.Address', 'Person.StateProvince']);
        expect(sub.tables).toHaveLength(2);
        expect(sub.edges).toHaveLength(1);
    });

    it('matches by bare table name', () => {
        const sub = getSubgraphForTables(graph, ['Address', 'StateProvince']);
        expect(sub.tables).toHaveLength(2);
        expect(sub.edges).toHaveLength(1);
    });

    it('excludes tables not in the list', () => {
        const sub = getSubgraphForTables(graph, ['Person.Address']);
        expect(sub.tables).toHaveLength(1);
        expect(sub.edges).toHaveLength(0); // edge requires both ends
    });
});

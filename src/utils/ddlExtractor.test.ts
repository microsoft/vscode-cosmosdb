/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extractStructuralDDL } from './ddlExtractor';

// Convenience wrapper for the legacy assertion shape (string-only).
function extract(sql: string): string {
    return extractStructuralDDL(sql).sql;
}

// ── Baseline: CREATE TABLE ──────────────────────────────────────────

describe('extractStructuralDDL', () => {
    it('extracts a simple CREATE TABLE', () => {
        const sql = `
            CREATE TABLE Orders (
                OrderID INT PRIMARY KEY,
                CustomerID INT,
                OrderDate DATE
            );
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE Orders');
        expect(result).toContain('OrderID INT PRIMARY KEY');
    });

    it('extracts CREATE TABLE IF NOT EXISTS', () => {
        const sql = `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100)
            );
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE IF NOT EXISTS users');
        expect(result).toContain('id SERIAL PRIMARY KEY');
    });

    it('extracts CREATE TABLE closed by ) without semicolon', () => {
        const sql = `
            CREATE TABLE Products (
                ProductID INT,
                Name NVARCHAR(100)
            )
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE Products');
        expect(result).toContain('ProductID INT');
    });

    // ── ALTER TABLE ─────────────────────────────────────────────────

    it('extracts ALTER TABLE ADD FOREIGN KEY', () => {
        const sql = `
            ALTER TABLE Orders ADD CONSTRAINT FK_Customer
                FOREIGN KEY (CustomerID) REFERENCES Customers(CustomerID);
        `;
        const result = extract(sql);
        expect(result).toContain('ALTER TABLE Orders');
        expect(result).toContain('FOREIGN KEY');
    });

    // ── CREATE INDEX ────────────────────────────────────────────────

    it('extracts CREATE INDEX', () => {
        const sql = `CREATE INDEX IX_Orders_Date ON Orders(OrderDate);`;
        const result = extract(sql);
        expect(result).toContain('CREATE INDEX IX_Orders_Date');
    });

    it('extracts CREATE UNIQUE INDEX', () => {
        const sql = `CREATE UNIQUE INDEX UX_Users_Email ON Users(Email);`;
        const result = extract(sql);
        expect(result).toContain('CREATE UNIQUE INDEX UX_Users_Email');
    });

    it('extracts CREATE CLUSTERED INDEX (SQL Server)', () => {
        const sql = `CREATE CLUSTERED INDEX CX_Orders ON Orders(OrderDate);`;
        const result = extract(sql);
        expect(result).toContain('CREATE CLUSTERED INDEX CX_Orders');
    });

    it('extracts CREATE NONCLUSTERED INDEX (SQL Server)', () => {
        const sql = `CREATE NONCLUSTERED INDEX IX_Orders_Cust ON Orders(CustomerID);`;
        const result = extract(sql);
        expect(result).toContain('CREATE NONCLUSTERED INDEX');
    });

    // ── CREATE VIEW ─────────────────────────────────────────────────

    it('extracts CREATE VIEW', () => {
        const sql = `
            CREATE VIEW vw_ActiveOrders AS
            SELECT * FROM Orders WHERE Status = 'Active';
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE VIEW vw_ActiveOrders');
    });

    it('extracts CREATE OR REPLACE VIEW', () => {
        const sql = `
            CREATE OR REPLACE VIEW vw_Users AS
            SELECT id, name FROM users;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE OR REPLACE VIEW vw_Users');
    });

    // ── CREATE SEQUENCE (PostgreSQL/Oracle) ─────────────────────────

    it('extracts CREATE SEQUENCE', () => {
        const sql = `CREATE SEQUENCE order_id_seq START WITH 1 INCREMENT BY 1;`;
        const result = extract(sql);
        expect(result).toContain('CREATE SEQUENCE order_id_seq');
    });

    // ── CREATE TYPE (PostgreSQL) ────────────────────────────────────

    it('extracts CREATE TYPE', () => {
        const sql = `
            CREATE TYPE mood AS ENUM (
                'sad', 'ok', 'happy'
            );
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TYPE mood');
    });

    // ── CREATE DOMAIN (PostgreSQL) ──────────────────────────────────

    it('extracts CREATE DOMAIN', () => {
        const sql = `CREATE DOMAIN positive_int AS INTEGER CHECK (VALUE > 0);`;
        const result = extract(sql);
        expect(result).toContain('CREATE DOMAIN positive_int');
    });

    // ── Procedures/Functions/Triggers excluded ──────────────────────

    it('does NOT extract CREATE PROCEDURE', () => {
        const sql = `
            CREATE PROCEDURE sp_GetOrders
            AS
            BEGIN
                SELECT * FROM Orders;
            END;
        `;
        const result = extract(sql);
        expect(result.trim()).toBe('');
    });

    it('does NOT extract CREATE FUNCTION', () => {
        const sql = `
            CREATE FUNCTION fn_GetTotal(@OrderID INT)
            RETURNS DECIMAL AS
            BEGIN
                RETURN (SELECT Total FROM Orders WHERE OrderID = @OrderID);
            END;
        `;
        const result = extract(sql);
        expect(result.trim()).toBe('');
    });

    it('does NOT extract CREATE TRIGGER', () => {
        const sql = `
            CREATE TRIGGER trg_AfterInsert ON Orders
            AFTER INSERT AS
            BEGIN
                PRINT 'New order inserted';
            END;
        `;
        const result = extract(sql);
        expect(result.trim()).toBe('');
    });

    // ── Comment stripping ───────────────────────────────────────────

    it('strips block comments', () => {
        const sql = `
            /* This is a block comment */
            CREATE TABLE T1 (id INT);
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).not.toContain('block comment');
    });

    it('strips single-line -- comments', () => {
        const sql = `
            -- This is a comment
            CREATE TABLE T1 (id INT); -- inline comment
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).not.toContain('This is a comment');
    });

    it('strips MySQL # comments', () => {
        const sql = `
            # This is a MySQL comment
            CREATE TABLE users (
                id INT PRIMARY KEY # auto-increment
            );
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE users');
        expect(result).not.toContain('MySQL comment');
        expect(result).not.toContain('auto-increment');
    });

    // ── Skip patterns ───────────────────────────────────────────────

    it('strips INSERT statements', () => {
        const sql = `
            CREATE TABLE T1 (id INT);
            INSERT INTO T1 VALUES (1);
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).not.toContain('INSERT');
    });

    it('strips UPDATE statements', () => {
        const sql = `
            UPDATE T1 SET id = 2 WHERE id = 1;
            CREATE TABLE T2 (id INT);
        `;
        const result = extract(sql);
        expect(result).not.toContain('UPDATE');
        expect(result).toContain('CREATE TABLE T2');
    });

    it('strips DELETE statements', () => {
        const sql = `DELETE FROM T1 WHERE id = 1;`;
        expect(extract(sql).trim()).toBe('');
    });

    it('strips EXEC/EXECUTE statements', () => {
        const sql = `EXEC sp_GetOrders;`;
        expect(extract(sql).trim()).toBe('');
    });

    it('strips SET statements', () => {
        const sql = `SET NOCOUNT ON;`;
        expect(extract(sql).trim()).toBe('');
    });

    it('strips USE statements', () => {
        const sql = `USE MyDatabase;`;
        expect(extract(sql).trim()).toBe('');
    });

    it('strips GO batch separator', () => {
        const sql = `
            CREATE TABLE T1 (id INT);
            GO
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).not.toMatch(/^\s*GO\s*$/m);
    });

    it('strips PRINT statements', () => {
        const sql = `PRINT 'Hello';`;
        expect(extract(sql).trim()).toBe('');
    });

    it('strips transaction commands', () => {
        const sql = `
            BEGIN TRANSACTION;
            COMMIT;
            ROLLBACK;
        `;
        expect(extract(sql).trim()).toBe('');
    });

    it('strips GRANT/REVOKE/DENY', () => {
        const sql = `
            GRANT SELECT ON T1 TO user1;
            REVOKE INSERT ON T1 FROM user1;
            DENY DELETE ON T1 TO user1;
        `;
        expect(extract(sql).trim()).toBe('');
    });

    it('strips DROP statements', () => {
        const sql = `
            DROP TABLE IF EXISTS T1;
            DROP INDEX IX_Temp;
        `;
        expect(extract(sql).trim()).toBe('');
    });

    // ── Multi-statement files ───────────────────────────────────────

    it('extracts multiple CREATE TABLEs interleaved with INSERTs', () => {
        const sql = `
            CREATE TABLE Customers (
                CustomerID INT PRIMARY KEY,
                Name NVARCHAR(100)
            );

            INSERT INTO Customers VALUES (1, 'Alice');
            INSERT INTO Customers VALUES (2, 'Bob');

            CREATE TABLE Orders (
                OrderID INT PRIMARY KEY,
                CustomerID INT
            );

            INSERT INTO Orders VALUES (1, 1);
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE Customers');
        expect(result).toContain('CREATE TABLE Orders');
        expect(result).not.toContain('INSERT');
    });

    // ── Unterminated statement flush ────────────────────────────────

    it('flushes an unterminated statement at end of input', () => {
        const sql = `
            CREATE TABLE T1 (
                id INT,
                name VARCHAR(50)
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).toContain('id INT');
    });

    // ── Mixed dialect file ──────────────────────────────────────────

    it('handles a mixed-dialect schema dump', () => {
        const sql = `
            # MySQL-style comment
            -- Standard SQL comment
            /* Block comment */

            SET FOREIGN_KEY_CHECKS = 0;
            DROP TABLE IF EXISTS old_table;

            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL
            );

            CREATE SEQUENCE invoice_seq START WITH 1000;

            CREATE TYPE status_enum AS ENUM ('active', 'inactive');

            CREATE DOMAIN positive_money AS NUMERIC(10,2) CHECK (VALUE >= 0);

            INSERT INTO users (id, email) VALUES (1, 'test@example.com');

            ALTER TABLE orders ADD CONSTRAINT fk_user
                FOREIGN KEY (user_id) REFERENCES users(id);

            CREATE INDEX idx_users_email ON users(email);
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE users');
        expect(result).toContain('CREATE SEQUENCE invoice_seq');
        expect(result).toContain('CREATE TYPE status_enum');
        expect(result).toContain('CREATE DOMAIN positive_money');
        expect(result).toContain('ALTER TABLE orders');
        expect(result).toContain('CREATE INDEX idx_users_email');
        expect(result).not.toContain('INSERT INTO');
        expect(result).not.toContain('SET FOREIGN_KEY_CHECKS');
        expect(result).not.toContain('DROP TABLE');
        expect(result).not.toContain('MySQL-style comment');
        expect(result).not.toContain('Standard SQL comment');
        expect(result).not.toContain('Block comment');
    });

    // ── Empty / no-match input ──────────────────────────────────────

    it('returns empty string for empty input', () => {
        expect(extract('')).toBe('');
    });

    it('returns empty string for non-structural SQL', () => {
        const sql = `
            INSERT INTO T1 VALUES (1);
            UPDATE T1 SET x = 1;
            DELETE FROM T1;
        `;
        expect(extract(sql).trim()).toBe('');
    });

    // ── Phase B: Storage / engine clause stripping ──────────────────

    describe('storage clause stripping', () => {
        it('strips WITH (...) option block on PRIMARY KEY', () => {
            const sql = `
                CREATE TABLE Orders (
                    OrderID INT NOT NULL,
                    CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED ([OrderID])
                    WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, FILLFACTOR = 90) ON [PRIMARY]
                );
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE Orders');
            expect(result).toContain('PRIMARY KEY CLUSTERED');
            expect(result).not.toMatch(/WITH\s*\(/i);
            expect(result).not.toMatch(/PAD_INDEX/i);
            expect(result).not.toMatch(/FILLFACTOR/i);
        });

        it('strips WITH (...) on CREATE INDEX (with nested parens)', () => {
            const sql = `CREATE INDEX IX_T ON T(C) WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (1 TO 4));`;
            const result = extract(sql);
            expect(result).toContain('CREATE INDEX IX_T ON T(C)');
            expect(result).not.toMatch(/WITH\s*\(/i);
            expect(result).not.toMatch(/DATA_COMPRESSION/i);
        });

        it('strips ON [PRIMARY] filegroup placement', () => {
            const sql = `CREATE TABLE T (id INT) ON [PRIMARY];`;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE T');
            expect(result).not.toMatch(/ON\s+\[PRIMARY\]/i);
        });

        it('strips TEXTIMAGE_ON and FILESTREAM_ON', () => {
            const sql = `CREATE TABLE T (id INT, blob VARBINARY(MAX)) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY] FILESTREAM_ON [PRIMARY];`;
            const result = extract(sql);
            expect(result).not.toMatch(/TEXTIMAGE_ON/i);
            expect(result).not.toMatch(/FILESTREAM_ON/i);
        });

        it('strips COLLATE column clauses', () => {
            const sql = `CREATE TABLE T (name NVARCHAR(50) COLLATE Latin1_General_100_CI_AS NOT NULL);`;
            const result = extract(sql);
            expect(result).toContain('NVARCHAR(50)');
            expect(result).toContain('NOT NULL');
            expect(result).not.toMatch(/COLLATE/i);
        });

        it('strips ROWGUIDCOL and NOT FOR REPLICATION', () => {
            const sql = `CREATE TABLE T (rowguid UNIQUEIDENTIFIER ROWGUIDCOL NOT NULL, id INT IDENTITY NOT FOR REPLICATION);`;
            const result = extract(sql);
            expect(result).not.toMatch(/ROWGUIDCOL/i);
            expect(result).not.toMatch(/NOT\s+FOR\s+REPLICATION/i);
            expect(result).toContain('UNIQUEIDENTIFIER');
            expect(result).toContain('IDENTITY');
        });
    });

    // ── Phase C: CREATE VIEW body summarization ─────────────────────

    describe('CREATE VIEW summarization', () => {
        it('replaces a simple view body with a references summary', () => {
            const sql = `
                CREATE VIEW vw_ActiveOrders AS
                SELECT * FROM Orders WHERE Status = 'Active';
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE VIEW vw_ActiveOrders AS');
            expect(result).toContain('-- references: Orders');
            expect(result).not.toMatch(/SELECT\s+\*/i);
            expect(result).not.toMatch(/WHERE/i);
        });

        it('lists all FROM and JOIN tables', () => {
            const sql = `
                CREATE VIEW vw_OrderDetails AS
                SELECT o.OrderID, c.Name, p.Title
                FROM Orders o
                INNER JOIN Customers c ON o.CustID = c.ID
                LEFT JOIN Products p ON o.ProdID = p.ID;
            `;
            const result = extract(sql);
            expect(result).toContain('-- references:');
            expect(result).toMatch(/Orders/);
            expect(result).toMatch(/Customers/);
            expect(result).toMatch(/Products/);
        });

        it('handles CREATE OR REPLACE VIEW', () => {
            const sql = `
                CREATE OR REPLACE VIEW vw_Users AS
                SELECT id, name FROM users;
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE OR REPLACE VIEW vw_Users AS');
            expect(result).toContain('-- references: users');
        });

        it('summarizes views with no detectable refs as (none detected)', () => {
            const sql = `CREATE VIEW vw_Const AS SELECT 1 AS X;`;
            const result = extract(sql);
            expect(result).toContain('-- references: (none detected)');
        });
    });

    // ── Phase D: drop redundant ALTER TABLE re-enable / CHECK ───────

    describe('redundant ALTER TABLE filtering', () => {
        it('drops ALTER TABLE … CHECK CONSTRAINT [FK_*] re-enable', () => {
            const sql = `
                ALTER TABLE Orders ADD CONSTRAINT FK_Cust FOREIGN KEY (CustID) REFERENCES Customers(ID);
                ALTER TABLE Orders CHECK CONSTRAINT [FK_Cust];
            `;
            const result = extract(sql);
            expect(result).toContain('ADD CONSTRAINT FK_Cust');
            expect(result).not.toMatch(/CHECK\s+CONSTRAINT\s+\[FK_Cust\]/i);
        });

        it('drops ALTER TABLE … NOCHECK CONSTRAINT', () => {
            const sql = `ALTER TABLE Orders NOCHECK CONSTRAINT [FK_Cust];`;
            const result = extract(sql);
            expect(result.trim()).toBe('');
        });

        it('drops ALTER TABLE … ADD CONSTRAINT [CK_*] CHECK (...)', () => {
            const sql = `ALTER TABLE Orders WITH CHECK ADD CONSTRAINT [CK_Status] CHECK ((Status >= 1 AND Status <= 7));`;
            const result = extract(sql);
            expect(result.trim()).toBe('');
        });
    });

    // ── CHECK constraints in CREATE TABLE are stripped, kept in DOMAIN

    describe('inline CHECK handling', () => {
        it('strips inline CHECK constraints in CREATE TABLE', () => {
            const sql = `
                CREATE TABLE T (
                    id INT,
                    status INT CHECK (status BETWEEN 1 AND 7),
                    CONSTRAINT [CK_T_id] CHECK ((id > 0))
                );
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE T');
            expect(result).toContain('id INT');
            expect(result).toContain('status INT');
            expect(result).not.toMatch(/CHECK\s*\(/i);
            expect(result).not.toMatch(/BETWEEN/i);
        });

        it('keeps CHECK clause inside CREATE DOMAIN', () => {
            const sql = `CREATE DOMAIN positive_int AS INTEGER CHECK (VALUE > 0);`;
            const result = extract(sql);
            expect(result).toContain('CREATE DOMAIN positive_int');
            expect(result).toMatch(/CHECK\s*\(VALUE > 0\)/i);
        });
    });

    // ── Phase E: new structural patterns ────────────────────────────

    describe('additional structural patterns', () => {
        it('extracts CREATE FULLTEXT INDEX', () => {
            const sql = `CREATE FULLTEXT INDEX ON Documents(Body) KEY INDEX PK_Documents ON ftCatalog;`;
            const result = extract(sql);
            expect(result).toContain('CREATE FULLTEXT INDEX');
            expect(result).toContain('Documents(Body)');
        });

        it('extracts CREATE SCHEMA', () => {
            const sql = `CREATE SCHEMA Sales AUTHORIZATION dbo;`;
            const result = extract(sql);
            expect(result).toContain('CREATE SCHEMA Sales');
        });
    });

    // ── End-to-end: SSMS-style AdventureWorks fragment ──────────────

    it('strips a realistic AdventureWorks-style table to its essence', () => {
        const sql = `
            SET ANSI_NULLS ON
            GO
            CREATE TABLE [Sales].[Customer](
                [CustomerID] [int] IDENTITY(1,1) NOT FOR REPLICATION NOT NULL,
                [PersonID] [int] NULL,
                [AccountNumber] [varchar](10) COLLATE Latin1_General_100_CI_AS NOT NULL,
                [rowguid] [uniqueidentifier] ROWGUIDCOL NOT NULL,
                CONSTRAINT [PK_Customer_CustomerID] PRIMARY KEY CLUSTERED ([CustomerID] ASC)
                    WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
            ) ON [PRIMARY];
            GO
            ALTER TABLE [Sales].[Customer] WITH CHECK ADD CONSTRAINT [FK_Customer_Person_PersonID] FOREIGN KEY([PersonID]) REFERENCES [Person].[Person] ([BusinessEntityID]);
            GO
            ALTER TABLE [Sales].[Customer] CHECK CONSTRAINT [FK_Customer_Person_PersonID];
            GO
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE [Sales].[Customer]');
        expect(result).toContain('PRIMARY KEY CLUSTERED');
        expect(result).toContain('FOREIGN KEY([PersonID])');
        expect(result).toContain('REFERENCES [Person].[Person]');
        // Noise removed
        expect(result).not.toMatch(/PAD_INDEX/i);
        expect(result).not.toMatch(/ALLOW_ROW_LOCKS/i);
        expect(result).not.toMatch(/ON\s+\[PRIMARY\]/i);
        expect(result).not.toMatch(/COLLATE/i);
        expect(result).not.toMatch(/ROWGUIDCOL/i);
        expect(result).not.toMatch(/NOT\s+FOR\s+REPLICATION/i);
        expect(result).not.toMatch(/CHECK\s+CONSTRAINT\s+\[FK_/i);
    });

    // ── Stats / observability ───────────────────────────────────────

    describe('ExtractionStats', () => {
        it('reports input/output sizes and a positive reduction ratio', () => {
            const sql = `
                CREATE TABLE T (
                    id INT,
                    name NVARCHAR(50) COLLATE Latin1_General_100_CI_AS NOT NULL,
                    CONSTRAINT [PK_T] PRIMARY KEY CLUSTERED (id)
                        WITH (PAD_INDEX = OFF, FILLFACTOR = 90) ON [PRIMARY]
                ) ON [PRIMARY];
            `;
            const { sql: out, stats } = extractStructuralDDL(sql);
            expect(stats.inputChars).toBe(sql.length);
            expect(stats.outputChars).toBe(out.length);
            expect(stats.outputChars).toBeLessThan(stats.inputChars);
            expect(stats.reductionRatio).toBeGreaterThan(0);
            expect(stats.reductionRatio).toBeLessThanOrEqual(1);
            expect(stats.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('returns zeroed stats and ratio 0 for empty input', () => {
            const { stats } = extractStructuralDDL('');
            expect(stats.inputChars).toBe(0);
            expect(stats.outputChars).toBe(0);
            expect(stats.reductionRatio).toBe(0);
            expect(stats.warnings).toEqual([]);
        });

        it('counts kept statements by type', () => {
            const sql = `
                CREATE SCHEMA Sales;
                CREATE TABLE Sales.Orders (id INT);
                CREATE INDEX IX_Orders ON Sales.Orders(id);
                CREATE FULLTEXT INDEX ON Sales.Orders(id) KEY INDEX PK_Orders;
                ALTER TABLE Sales.Orders ADD CONSTRAINT FK_C FOREIGN KEY (id) REFERENCES C(id);
                CREATE SEQUENCE Sales.Seq START WITH 1;
                CREATE TYPE Sales.MyType FROM INT;
                CREATE DOMAIN PosInt AS INT CHECK (VALUE > 0);
                CREATE VIEW Sales.V AS SELECT * FROM Sales.Orders;
            `;
            const { stats } = extractStructuralDDL(sql);
            expect(stats.statementCounts.createSchema).toBe(1);
            expect(stats.statementCounts.createTable).toBe(1);
            expect(stats.statementCounts.createIndex).toBe(1);
            expect(stats.statementCounts.createFulltextIndex).toBe(1);
            expect(stats.statementCounts.alterTable).toBe(1);
            expect(stats.statementCounts.createSequence).toBe(1);
            expect(stats.statementCounts.createType).toBe(1);
            expect(stats.statementCounts.createDomain).toBe(1);
            expect(stats.statementCounts.createView).toBe(1);
            expect(stats.statementCounts.other).toBe(0);
        });

        it('counts dropped ALTER TABLE noise', () => {
            const sql = `
                ALTER TABLE T CHECK CONSTRAINT [FK_X];
                ALTER TABLE T NOCHECK CONSTRAINT [FK_Y];
                ALTER TABLE T WITH CHECK ADD CONSTRAINT [CK_Z] CHECK ((Status > 0));
            `;
            const { stats } = extractStructuralDDL(sql);
            expect(stats.drops.alterTableCheckReenable).toBe(2);
            expect(stats.drops.alterTableCheckConstraint).toBe(1);
            expect(stats.statementCounts.alterTable).toBe(0);
        });

        it('counts noise stripped from kept statements', () => {
            const sql = `
                CREATE TABLE T (
                    id INT IDENTITY NOT FOR REPLICATION,
                    rowguid UNIQUEIDENTIFIER ROWGUIDCOL NOT NULL,
                    name NVARCHAR(50) COLLATE Latin1_General_100_CI_AS,
                    CONSTRAINT [PK_T] PRIMARY KEY (id) WITH (FILLFACTOR = 90) ON [PRIMARY]
                ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY] FILESTREAM_ON [PRIMARY];
            `;
            const { stats } = extractStructuralDDL(sql);
            expect(stats.strips.withOptionBlocks).toBe(1);
            expect(stats.strips.collate).toBe(1);
            expect(stats.strips.rowGuidCol).toBe(1);
            expect(stats.strips.notForReplication).toBe(1);
            expect(stats.strips.onPrimary).toBeGreaterThanOrEqual(1);
            expect(stats.strips.textImageOn).toBe(1);
            expect(stats.strips.fileStreamOn).toBe(1);
        });

        it('counts inline CHECK constraints stripped from CREATE TABLE', () => {
            const sql = `
                CREATE TABLE T (
                    id INT,
                    status INT CHECK (status BETWEEN 1 AND 7),
                    CONSTRAINT [CK_T] CHECK ((id > 0))
                );
            `;
            const { stats } = extractStructuralDDL(sql);
            expect(stats.strips.inlineCheckConstraints).toBe(2);
        });

        it('counts summarized views and total table references', () => {
            const sql = `
                CREATE VIEW V1 AS SELECT * FROM A INNER JOIN B ON A.id = B.id;
                CREATE VIEW V2 AS SELECT 1 AS X;
                CREATE VIEW V3 AS SELECT * FROM C, D LEFT JOIN E ON C.id = E.id;
            `;
            const { stats } = extractStructuralDDL(sql);
            expect(stats.views.summarized).toBe(3);
            // V1: A,B = 2; V2: 0; V3: C,E = 2 (D follows comma, not FROM/JOIN)
            expect(stats.views.referencedTablesTotal).toBeGreaterThanOrEqual(3);
        });

        it('emits a warning for an unterminated DDL statement', () => {
            const sql = `CREATE TABLE T (\n    id INT,\n    name NVARCHAR(50)\n`;
            const { stats } = extractStructuralDDL(sql);
            expect(stats.warnings.length).toBeGreaterThan(0);
            expect(stats.warnings[0]).toMatch(/unterminated/i);
        });
    });
});

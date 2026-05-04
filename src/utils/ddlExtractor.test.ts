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

    // ── Procedures/Functions/Triggers (summarized for access-pattern signal) ──

    it('summarizes CREATE PROCEDURE with reads/writes', () => {
        const sql = `
            CREATE PROCEDURE sp_GetOrders
            AS
            BEGIN
                SELECT * FROM Orders;
            END;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE PROCEDURE sp_GetOrders');
        expect(result).toContain('reads: Orders');
        expect(result).toContain('writes: (none)');
        expect(result).toContain('Cosmos DB best practice');
    });

    it('summarizes CREATE FUNCTION with signature and RETURNS clause', () => {
        const sql = `
            CREATE FUNCTION fn_GetTotal(@OrderID INT)
            RETURNS DECIMAL AS
            BEGIN
                RETURN (SELECT Total FROM Orders WHERE OrderID = @OrderID);
            END;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE FUNCTION fn_GetTotal');
        expect(result).toContain('RETURNS DECIMAL');
        expect(result).toContain('reads: Orders');
    });

    it('summarizes T-SQL TRIGGER (ON <table> AFTER <event> order)', () => {
        const sql = `
            CREATE TRIGGER trg_AfterInsert ON Orders
            AFTER INSERT AS
            BEGIN
                INSERT INTO AuditLog (msg) VALUES ('inserted');
            END;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TRIGGER trg_AfterInsert AFTER INSERT ON Orders');
        expect(result).toContain('writes: AuditLog');
    });

    it('summarizes PostgreSQL trigger (BEFORE UPDATE ON <table> order)', () => {
        const sql = `
            CREATE TRIGGER trg_audit BEFORE UPDATE ON public.users
            FOR EACH ROW EXECUTE PROCEDURE audit_fn();
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TRIGGER trg_audit BEFORE UPDATE ON public.users');
    });

    it('summarizes PL/pgSQL function with $$ dollar-quoted body', () => {
        const sql = `
            CREATE OR REPLACE FUNCTION public.refresh_totals() RETURNS void AS $$
            BEGIN
                DELETE FROM totals;
                INSERT INTO totals SELECT user_id, SUM(amount) FROM orders GROUP BY user_id;
            END;
            $$ LANGUAGE plpgsql;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE FUNCTION public.refresh_totals()');
        expect(result).toMatch(/writes: (?:totals, orders|orders, totals|totals)/);
        // DELETE FROM totals + INSERT INTO totals → writes contains totals; orders is read.
        expect(result).toContain('reads: orders');
        expect(result).toContain('writes: totals');
    });

    it('summarizes PL/SQL procedure with BEGIN..END block', () => {
        const sql = `
            CREATE OR REPLACE PROCEDURE hr.archive_orders IS
            BEGIN
                INSERT INTO orders_archive SELECT * FROM orders WHERE created_at < SYSDATE - 365;
                DELETE FROM orders WHERE created_at < SYSDATE - 365;
            END;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE PROCEDURE hr.archive_orders');
        expect(result).toContain('writes: orders_archive');
        expect(result).toContain('orders');
    });

    it('procedure without DML reports reads/writes (none)', () => {
        const sql = `
            CREATE PROCEDURE sp_noop AS BEGIN SET NOCOUNT ON; END;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE PROCEDURE sp_noop');
        expect(result).toContain('reads: (none)');
        expect(result).toContain('writes: (none)');
    });

    it('disclaimer is omitted when no body objects are present', () => {
        const sql = `CREATE TABLE t (id INT PRIMARY KEY);`;
        const result = extract(sql);
        expect(result).not.toContain('Cosmos DB best practice');
        expect(result).not.toContain('summarized below');
    });

    it('classifies DELETE FROM as a write, not a read', () => {
        const sql = `
            CREATE PROCEDURE sp_purge AS
            BEGIN
                DELETE FROM Orders WHERE Status = 'Done';
            END;
        `;
        const result = extract(sql);
        expect(result).toContain('writes: Orders');
        expect(result).toContain('reads: (none)');
    });

    it('combined schema + procedure: stats counters are populated', () => {
        const sql = `
            CREATE TABLE t (id INT);
            CREATE PROCEDURE p1 AS BEGIN INSERT INTO t (id) VALUES (1); END;
            CREATE PROCEDURE p2 AS BEGIN SELECT * FROM t; END;
        `;
        const { sql: out, stats } = extractStructuralDDL(sql);
        expect(out).toContain('CREATE TABLE');
        expect(stats.statementCounts.createProcedure).toBe(2);
        expect(stats.procedures.summarized).toBe(2);
        expect(stats.procedures.readsTotal).toBeGreaterThanOrEqual(1);
        expect(stats.procedures.writesTotal).toBeGreaterThanOrEqual(1);
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

    // ── Phase F-K: PostgreSQL / MySQL noise stripping ───────────────

    describe('PostgreSQL noise', () => {
        it('strips WITH (...) option blocks on PostgreSQL tables', () => {
            const sql = `CREATE TABLE t (id INT) WITH (fillfactor=70, autovacuum_enabled=false);`;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/fillfactor/i);
        });

        it('strips TABLESPACE placement', () => {
            const sql = `CREATE TABLE t (id INT) TABLESPACE pg_default;`;
            const result = extract(sql);
            expect(result).not.toMatch(/TABLESPACE/i);
            expect(result).toContain('CREATE TABLE t');
        });

        it('strips COLLATE with quoted name', () => {
            const sql = `CREATE TABLE t (name TEXT COLLATE "en_US" NOT NULL);`;
            const result = extract(sql);
            expect(result).not.toMatch(/COLLATE/i);
            expect(result).toContain('NOT NULL');
        });

        it('drops ALTER ... OWNER TO statements', () => {
            const sql = `
                ALTER TABLE public.users OWNER TO postgres;
                ALTER SEQUENCE foo_seq OWNER TO postgres;
                ALTER VIEW v1 OWNER TO postgres;
            `;
            const result = extract(sql);
            expect(result.trim()).toBe('');
        });

        it('drops ALTER SEQUENCE ... OWNED BY', () => {
            const sql = `ALTER SEQUENCE foo_seq OWNED BY t.id;`;
            const result = extract(sql);
            expect(result.trim()).toBe('');
        });

        it('drops ALTER TABLE ... REPLICA IDENTITY', () => {
            const sql = `ALTER TABLE t REPLICA IDENTITY FULL;`;
            const result = extract(sql);
            expect(result.trim()).toBe('');
        });

        it('skips pg_catalog SELECT calls', () => {
            const sql = `SELECT pg_catalog.setval('foo_id_seq', 12345, true);`;
            expect(extract(sql).trim()).toBe('');
        });

        it('skips psql backslash meta-commands', () => {
            const sql = `\\connect postgres\n\\restrict\nCREATE TABLE t (id INT);`;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/\\connect/);
        });

        it('captures CREATE EXTENSION', () => {
            const sql = `CREATE EXTENSION IF NOT EXISTS pgvector;`;
            const result = extract(sql);
            expect(result).toContain('CREATE EXTENSION');
            expect(result).toContain('pgvector');
        });

        it('captures CREATE FOREIGN TABLE', () => {
            const sql = `
                CREATE FOREIGN TABLE remote_users (
                    id INT,
                    name TEXT
                ) SERVER remote_srv;
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE FOREIGN TABLE remote_users');
            expect(result).toContain('id INT');
        });

        it('summarizes CREATE MATERIALIZED VIEW like a regular view', () => {
            const sql = `
                CREATE MATERIALIZED VIEW mv_stats AS
                SELECT user_id, COUNT(*) FROM events GROUP BY user_id;
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE MATERIALIZED VIEW mv_stats AS');
            expect(result).toContain('-- references: events');
            expect(result).not.toMatch(/COUNT\(\*\)/i);
        });

        it('summarized matview captures quoted schema-qualified refs', () => {
            const sql = `CREATE MATERIALIZED VIEW mv AS SELECT * FROM "Sales"."Orders";`;
            const result = extract(sql);
            expect(result).toContain('-- references: "Sales"."Orders"');
        });
    });

    describe('COMMENT ON handling', () => {
        it('keeps short COMMENT ON statements', () => {
            const sql = `COMMENT ON TABLE users IS 'Application users';`;
            const result = extract(sql);
            expect(result).toContain("COMMENT ON TABLE users IS 'Application users'");
        });

        it('drops COMMENT ON whose text exceeds 200 chars', () => {
            const longText = 'x'.repeat(250);
            const sql = `COMMENT ON COLUMN t.c IS '${longText}';`;
            const { sql: out, stats } = extractStructuralDDL(sql);
            expect(out.trim()).toBe('');
            expect(stats.drops.commentTooLong).toBe(1);
        });

        it('handles doubled-quote escapes when measuring length', () => {
            // 'It''s OK' — literal text length is 7 (apostrophe counts once)
            const sql = `COMMENT ON TABLE t IS 'It''s OK';`;
            const result = extract(sql);
            expect(result).toContain("It''s OK");
        });
    });

    describe('MySQL noise', () => {
        it('strips trailing CREATE TABLE engine/charset/auto_increment options', () => {
            const sql = `
                CREATE TABLE users (
                    id INT,
                    name VARCHAR(50)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci AUTO_INCREMENT=12345 ROW_FORMAT=DYNAMIC COMMENT='app users';
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE users');
            expect(result).toContain('VARCHAR(50)');
            expect(result).not.toMatch(/ENGINE\s*=/i);
            expect(result).not.toMatch(/CHARSET/i);
            expect(result).not.toMatch(/AUTO_INCREMENT\s*=/i);
            expect(result).not.toMatch(/ROW_FORMAT/i);
        });

        it('strips inline column COMMENT clauses', () => {
            const sql = `CREATE TABLE t (id INT NOT NULL COMMENT 'primary key', name VARCHAR(50) COMMENT 'display name');`;
            const result = extract(sql);
            expect(result).not.toMatch(/COMMENT\s+'/i);
            expect(result).toContain('id INT NOT NULL');
        });

        it('skips LOCK TABLES / UNLOCK TABLES', () => {
            const sql = `LOCK TABLES users WRITE;\nUNLOCK TABLES;\nCREATE TABLE t (id INT);`;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/LOCK\s+TABLES/i);
        });

        it('skips DELIMITER directives', () => {
            const sql = `DELIMITER //\nCREATE TABLE t (id INT);`;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/DELIMITER/i);
        });

        it('strips CHARACTER SET on column', () => {
            const sql = `CREATE TABLE t (name VARCHAR(50) CHARACTER SET utf8mb4 NOT NULL);`;
            const result = extract(sql);
            expect(result).not.toMatch(/CHARACTER\s+SET/i);
            expect(result).toContain('NOT NULL');
        });
    });

    // ── Phase L: Oracle noise stripping ─────────────────────────────

    describe('Oracle noise', () => {
        it('strips STORAGE (...) blocks (balanced parens)', () => {
            const sql = `
                CREATE TABLE t (id NUMBER) STORAGE (
                    INITIAL 64K NEXT 1M MINEXTENTS 1 MAXEXTENTS UNLIMITED
                    PCTINCREASE 0 BUFFER_POOL DEFAULT
                );
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/STORAGE\s*\(/i);
            expect(result).not.toMatch(/INITIAL\s+64K/i);
        });

        it('strips USING INDEX (...) constraint storage block', () => {
            const sql = `ALTER TABLE t ADD CONSTRAINT pk_t PRIMARY KEY (id) USING INDEX (CREATE INDEX foo ON t(id));`;
            const result = extract(sql);
            expect(result).toContain('PRIMARY KEY (id)');
            expect(result).not.toMatch(/USING\s+INDEX\s*\(/i);
        });

        it('strips trailing Oracle storage keywords', () => {
            const sql = `CREATE TABLE t (id NUMBER) PCTFREE 10 PCTUSED 40 INITRANS 1 MAXTRANS 255 NOCOMPRESS LOGGING NOCACHE NOPARALLEL MONITORING;`;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/PCTFREE/i);
            expect(result).not.toMatch(/PCTUSED/i);
            expect(result).not.toMatch(/INITRANS/i);
            expect(result).not.toMatch(/MAXTRANS/i);
            expect(result).not.toMatch(/NOCOMPRESS/i);
            expect(result).not.toMatch(/LOGGING/i);
            expect(result).not.toMatch(/NOCACHE/i);
            expect(result).not.toMatch(/NOPARALLEL/i);
            expect(result).not.toMatch(/MONITORING/i);
        });

        it('strips SEGMENT CREATION DEFERRED/IMMEDIATE', () => {
            const sql = `CREATE TABLE t (id NUMBER) SEGMENT CREATION DEFERRED;`;
            const result = extract(sql);
            expect(result).not.toMatch(/SEGMENT\s+CREATION/i);
        });

        it('strips Oracle constraint state suffixes', () => {
            const sql = `ALTER TABLE t ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED ENABLE NOVALIDATE;`;
            const result = extract(sql);
            expect(result).toContain('FOREIGN KEY (id)');
            expect(result).toContain('REFERENCES p(id)');
            expect(result).not.toMatch(/DEFERRABLE/i);
            expect(result).not.toMatch(/INITIALLY\s+DEFERRED/i);
            expect(result).not.toMatch(/\bENABLE\b/i);
            expect(result).not.toMatch(/NOVALIDATE/i);
        });

        it('skips PROMPT, SPOOL, WHENEVER, REM, CONNECT', () => {
            const sql = `
                PROMPT Creating user table
                SPOOL output.log
                WHENEVER SQLERROR EXIT FAILURE
                REM This is a remark
                CONNECT scott/tiger
                CREATE TABLE t (id NUMBER);
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/PROMPT/i);
            expect(result).not.toMatch(/SPOOL/i);
            expect(result).not.toMatch(/WHENEVER/i);
        });

        it('captures CREATE BITMAP INDEX', () => {
            const sql = `CREATE BITMAP INDEX idx_status ON orders(status);`;
            const result = extract(sql);
            expect(result).toContain('CREATE BITMAP INDEX idx_status');
        });

        it('skips CREATE GLOBAL TEMPORARY TABLE', () => {
            const sql = `
                CREATE GLOBAL TEMPORARY TABLE tmp_session (
                    id NUMBER,
                    payload VARCHAR2(4000)
                ) ON COMMIT PRESERVE ROWS;
                CREATE TABLE persistent (id NUMBER);
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE persistent');
            expect(result).not.toMatch(/GLOBAL\s+TEMPORARY/i);
            expect(result).not.toMatch(/tmp_session/i);
        });

        it('skips CREATE OR REPLACE PACKAGE bodies', () => {
            const sql = `
                CREATE OR REPLACE PACKAGE pkg AS
                    PROCEDURE foo;
                END pkg;
                CREATE TABLE t (id NUMBER);
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/PACKAGE/i);
        });

        it('skips CREATE SYNONYM', () => {
            const sql = `CREATE OR REPLACE PUBLIC SYNONYM emp FOR scott.employee;`;
            expect(extract(sql).trim()).toBe('');
        });

        it('skips CREATE MATERIALIZED VIEW LOG (must precede matview start pattern)', () => {
            const sql = `
                CREATE MATERIALIZED VIEW LOG ON orders WITH ROWID, PRIMARY KEY;
                CREATE MATERIALIZED VIEW mv AS SELECT * FROM orders;
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE MATERIALIZED VIEW mv AS');
            expect(result).not.toMatch(/MATERIALIZED\s+VIEW\s+LOG/i);
        });

        it('captures CREATE OR REPLACE FORCE EDITIONABLE VIEW', () => {
            const sql = `
                CREATE OR REPLACE FORCE EDITIONABLE VIEW vw AS
                SELECT id FROM orders;
            `;
            const result = extract(sql);
            expect(result).toContain('VIEW vw');
            expect(result).toContain('-- references: orders');
        });
    });

    // ── MySQL DEFINER/ALGORITHM/SQL SECURITY prefix stripping ───────

    describe('MySQL CREATE prefixes', () => {
        it('captures CREATE VIEW with ALGORITHM/DEFINER/SQL SECURITY prefixes', () => {
            const sql =
                'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW v AS SELECT id FROM orders;';
            const result = extract(sql);
            expect(result).toContain('VIEW v');
            expect(result).toContain('-- references: orders');
        });

        it('summarizes CREATE PROCEDURE with DEFINER prefix', () => {
            const sql = "CREATE DEFINER=`root`@`%` PROCEDURE p() BEGIN INSERT INTO t (x) VALUES (1); END;";
            const result = extract(sql);
            expect(result).toContain('CREATE PROCEDURE p()');
            expect(result).toContain('writes: t');
        });

        it('summarizes CREATE FUNCTION with DEFINER prefix', () => {
            const sql =
                "CREATE DEFINER=`root`@`%` FUNCTION f() RETURNS INT DETERMINISTIC BEGIN RETURN (SELECT COUNT(*) FROM t); END;";
            const result = extract(sql);
            expect(result).toContain('CREATE FUNCTION f()');
            expect(result).toContain('reads: t');
        });

        it('summarizes CREATE TRIGGER with DEFINER prefix', () => {
            const sql =
                "CREATE DEFINER=`root`@`%` TRIGGER trg BEFORE INSERT ON orders FOR EACH ROW BEGIN INSERT INTO audit (msg) VALUES ('x'); END;";
            const result = extract(sql);
            expect(result).toContain('CREATE TRIGGER trg BEFORE INSERT ON orders');
            expect(result).toContain('writes: audit');
        });

        it('summarizes CREATE EVENT with DEFINER and schedule', () => {
            const sql =
                "CREATE DEFINER=`root`@`%` EVENT ev ON SCHEDULE EVERY 1 DAY DO BEGIN DELETE FROM logs WHERE created < NOW() - INTERVAL 30 DAY; END;";
            const result = extract(sql);
            expect(result).toContain('CREATE EVENT ev ON SCHEDULE EVERY 1 DAY');
            expect(result).toContain('writes: logs');
        });
    });

    // ── Skip patterns: rare/admin objects ───────────────────────────

    describe('skip rare and admin statements', () => {
        it.each([
            ['CREATE POLICY p1 ON t USING (true);', 'POLICY'],
            ['CREATE RULE notify_me AS ON UPDATE TO t DO NOTIFY t;', 'RULE'],
            ['CREATE PARTITION FUNCTION pf (int) AS RANGE LEFT FOR VALUES (1, 2, 3);', 'PARTITION FUNCTION'],
            ['CREATE PARTITION SCHEME ps AS PARTITION pf TO ([PRIMARY]);', 'PARTITION SCHEME'],
            ['CREATE EVENT TRIGGER et ON ddl_command_start EXECUTE FUNCTION f();', 'EVENT TRIGGER'],
            ['CREATE TYPE BODY tb AS BEGIN NULL; END;', 'TYPE BODY'],
            ['CREATE LIBRARY lib AS \'/tmp/lib.so\';', 'LIBRARY'],
            ['CREATE DIRECTORY dir AS \'/tmp\';', 'DIRECTORY'],
            ['CREATE PROFILE prof LIMIT SESSIONS_PER_USER 5;', 'PROFILE'],
            ['CREATE SERVER fdw_srv FOREIGN DATA WRAPPER pg;', 'SERVER'],
            ['CREATE COLLATION french (LOCALE = \'fr_FR\');', 'COLLATION'],
            ['CREATE STATISTICS s ON x, y FROM t;', 'STATISTICS'],
            ['CREATE AGGREGATE my_sum(int) (SFUNC = int4pl, STYPE = int);', 'AGGREGATE'],
            ['CREATE OPERATOR === (LEFTARG = int, RIGHTARG = int, FUNCTION = int4eq);', 'OPERATOR'],
            ['CREATE ASSEMBLY asm FROM 0x4D5A;', 'ASSEMBLY'],
            ['CREATE LOGIN bob WITH PASSWORD = \'x\';', 'LOGIN'],
            ['CREATE ROLE admin;', 'ROLE'],
            ['ANALYZE TABLE t;', 'ANALYZE'],
            ['VACUUM FULL;', 'VACUUM'],
            ['REINDEX TABLE t;', 'REINDEX'],
            ['CLUSTER t USING idx_t;', 'CLUSTER'],
            ['LISTEN ch;', 'LISTEN'],
            ['NOTIFY ch, \'msg\';', 'NOTIFY'],
            ['SAVEPOINT sp1;', 'SAVEPOINT'],
            ['START TRANSACTION READ ONLY;', 'START TRANSACTION'],
            ['ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;', 'ALTER DEFAULT PRIVILEGES'],
            ['SECURITY LABEL ON TABLE t IS \'classified\';', 'SECURITY LABEL'],
        ])('skips %s', (sql) => {
            expect(extract(sql).trim()).toBe('');
        });

        it('does not strip a real ANALYZE-prefixed identifier (sanity)', () => {
            // Just ensure CREATE TABLE survives alongside skipped ANALYZE.
            const sql = `
                CREATE TABLE t (id INT);
                ANALYZE TABLE t;
            `;
            const result = extract(sql);
            expect(result).toContain('CREATE TABLE t');
            expect(result).not.toMatch(/^ANALYZE/im);
        });
    });

    // ── End-to-end cross-dialect realism ────────────────────────────

    it('strips a realistic pg_dump fragment to its essence', () => {
        const sql = `
            --
            -- PostgreSQL database dump
            --
            SET statement_timeout = 0;
            SET lock_timeout = 0;
            SELECT pg_catalog.set_config('search_path', '', false);

            CREATE EXTENSION IF NOT EXISTS pgvector;

            CREATE TABLE public.users (
                id integer NOT NULL,
                email text COLLATE "en_US" NOT NULL,
                embedding vector(1536)
            ) WITH (fillfactor=70) TABLESPACE pg_default;

            ALTER TABLE public.users OWNER TO postgres;

            CREATE SEQUENCE public.users_id_seq START 1;
            ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
            ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

            COMMENT ON TABLE public.users IS 'application users';
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE EXTENSION');
        expect(result).toContain('pgvector');
        expect(result).toContain('CREATE TABLE public.users');
        expect(result).toContain('vector(1536)');
        expect(result).toContain('CREATE SEQUENCE');
        expect(result).toContain("COMMENT ON TABLE public.users IS 'application users'");
        // Noise removed
        expect(result).not.toMatch(/fillfactor/i);
        expect(result).not.toMatch(/TABLESPACE/i);
        expect(result).not.toMatch(/COLLATE/i);
        expect(result).not.toMatch(/OWNER\s+TO/i);
        expect(result).not.toMatch(/OWNED\s+BY/i);
        expect(result).not.toMatch(/pg_catalog/i);
    });

    it('strips a realistic mysqldump fragment to its essence', () => {
        const sql = `
            -- MySQL dump 10.13
            /*!40101 SET NAMES utf8 */;
            DELIMITER ;;
            LOCK TABLES \`users\` WRITE;
            CREATE TABLE \`users\` (
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`email\` varchar(255) CHARACTER SET utf8mb4 NOT NULL COMMENT 'login email',
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB AUTO_INCREMENT=12345 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='users';
            UNLOCK TABLES;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE `users`');
        expect(result).toContain('AUTO_INCREMENT');
        expect(result).toContain('PRIMARY KEY');
        expect(result).not.toMatch(/ENGINE\s*=/i);
        expect(result).not.toMatch(/CHARSET/i);
        expect(result).not.toMatch(/CHARACTER\s+SET/i);
        expect(result).not.toMatch(/ROW_FORMAT/i);
        expect(result).not.toMatch(/COMMENT\s+'/i);
        expect(result).not.toMatch(/LOCK\s+TABLES/i);
        expect(result).not.toMatch(/DELIMITER/i);
    });

    it('strips a realistic Oracle expdp fragment to its essence', () => {
        const sql = `
            REM Oracle Database 19c
            PROMPT Creating EMPLOYEES table
            WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

            CREATE TABLE "HR"."EMPLOYEES" (
                "EMPLOYEE_ID" NUMBER(6,0) NOT NULL,
                "FIRST_NAME"  VARCHAR2(20),
                "LAST_NAME"   VARCHAR2(25) NOT NULL,
                "EMAIL"       VARCHAR2(25) NOT NULL,
                CONSTRAINT "EMP_EMP_ID_PK" PRIMARY KEY ("EMPLOYEE_ID") USING INDEX (
                    CREATE UNIQUE INDEX "EMP_EMP_ID_PK" ON "HR"."EMPLOYEES" ("EMPLOYEE_ID")
                )
            )
            SEGMENT CREATION IMMEDIATE
            PCTFREE 10 PCTUSED 40 INITRANS 1 MAXTRANS 255
            NOCOMPRESS LOGGING
            STORAGE (INITIAL 65536 NEXT 1048576 MINEXTENTS 1 MAXEXTENTS 2147483645
                     PCTINCREASE 0 FREELISTS 1 FREELIST GROUPS 1
                     BUFFER_POOL DEFAULT FLASH_CACHE DEFAULT CELL_FLASH_CACHE DEFAULT)
            TABLESPACE "USERS";

            CREATE BITMAP INDEX "EMP_DEPT_IX" ON "HR"."EMPLOYEES" ("DEPARTMENT_ID");

            CREATE OR REPLACE PUBLIC SYNONYM EMP FOR HR.EMPLOYEES;
            CREATE GLOBAL TEMPORARY TABLE tmp_x (id NUMBER);
            CREATE MATERIALIZED VIEW LOG ON "HR"."EMPLOYEES" WITH ROWID;
        `;
        const result = extract(sql);
        expect(result).toContain('CREATE TABLE "HR"."EMPLOYEES"');
        expect(result).toContain('"EMPLOYEE_ID" NUMBER(6,0) NOT NULL');
        expect(result).toContain('PRIMARY KEY ("EMPLOYEE_ID")');
        expect(result).toContain('CREATE BITMAP INDEX "EMP_DEPT_IX"');
        // Noise removed
        expect(result).not.toMatch(/SEGMENT\s+CREATION/i);
        expect(result).not.toMatch(/PCTFREE/i);
        expect(result).not.toMatch(/STORAGE\s*\(/i);
        expect(result).not.toMatch(/USING\s+INDEX\s*\(/i);
        expect(result).not.toMatch(/TABLESPACE/i);
        expect(result).not.toMatch(/NOCOMPRESS/i);
        expect(result).not.toMatch(/LOGGING/i);
        // Non-structural objects skipped
        expect(result).not.toMatch(/SYNONYM/i);
        expect(result).not.toMatch(/GLOBAL\s+TEMPORARY/i);
        expect(result).not.toMatch(/MATERIALIZED\s+VIEW\s+LOG/i);
        expect(result).not.toMatch(/PROMPT/i);
        expect(result).not.toMatch(/WHENEVER/i);
    });
});

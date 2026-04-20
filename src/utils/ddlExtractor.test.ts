/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extractStructuralDDL } from './ddlExtractor';

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
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE TABLE Products');
        expect(result).toContain('ProductID INT');
    });

    // ── ALTER TABLE ─────────────────────────────────────────────────

    it('extracts ALTER TABLE ADD FOREIGN KEY', () => {
        const sql = `
            ALTER TABLE Orders ADD CONSTRAINT FK_Customer
                FOREIGN KEY (CustomerID) REFERENCES Customers(CustomerID);
        `;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('ALTER TABLE Orders');
        expect(result).toContain('FOREIGN KEY');
    });

    // ── CREATE INDEX ────────────────────────────────────────────────

    it('extracts CREATE INDEX', () => {
        const sql = `CREATE INDEX IX_Orders_Date ON Orders(OrderDate);`;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE INDEX IX_Orders_Date');
    });

    it('extracts CREATE UNIQUE INDEX', () => {
        const sql = `CREATE UNIQUE INDEX UX_Users_Email ON Users(Email);`;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE UNIQUE INDEX UX_Users_Email');
    });

    it('extracts CREATE CLUSTERED INDEX (SQL Server)', () => {
        const sql = `CREATE CLUSTERED INDEX CX_Orders ON Orders(OrderDate);`;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE CLUSTERED INDEX CX_Orders');
    });

    it('extracts CREATE NONCLUSTERED INDEX (SQL Server)', () => {
        const sql = `CREATE NONCLUSTERED INDEX IX_Orders_Cust ON Orders(CustomerID);`;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE NONCLUSTERED INDEX');
    });

    // ── CREATE VIEW ─────────────────────────────────────────────────

    it('extracts CREATE VIEW', () => {
        const sql = `
            CREATE VIEW vw_ActiveOrders AS
            SELECT * FROM Orders WHERE Status = 'Active';
        `;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE VIEW vw_ActiveOrders');
    });

    it('extracts CREATE OR REPLACE VIEW', () => {
        const sql = `
            CREATE OR REPLACE VIEW vw_Users AS
            SELECT id, name FROM users;
        `;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE OR REPLACE VIEW vw_Users');
    });

    // ── CREATE SEQUENCE (PostgreSQL/Oracle) ─────────────────────────

    it('extracts CREATE SEQUENCE', () => {
        const sql = `CREATE SEQUENCE order_id_seq START WITH 1 INCREMENT BY 1;`;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE SEQUENCE order_id_seq');
    });

    // ── CREATE TYPE (PostgreSQL) ────────────────────────────────────

    it('extracts CREATE TYPE', () => {
        const sql = `
            CREATE TYPE mood AS ENUM (
                'sad', 'ok', 'happy'
            );
        `;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE TYPE mood');
    });

    // ── CREATE DOMAIN (PostgreSQL) ──────────────────────────────────

    it('extracts CREATE DOMAIN', () => {
        const sql = `CREATE DOMAIN positive_int AS INTEGER CHECK (VALUE > 0);`;
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
        expect(result.trim()).toBe('');
    });

    // ── Comment stripping ───────────────────────────────────────────

    it('strips block comments', () => {
        const sql = `
            /* This is a block comment */
            CREATE TABLE T1 (id INT);
        `;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).not.toContain('block comment');
    });

    it('strips single-line -- comments', () => {
        const sql = `
            -- This is a comment
            CREATE TABLE T1 (id INT); -- inline comment
        `;
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).not.toContain('INSERT');
    });

    it('strips UPDATE statements', () => {
        const sql = `
            UPDATE T1 SET id = 2 WHERE id = 1;
            CREATE TABLE T2 (id INT);
        `;
        const result = extractStructuralDDL(sql);
        expect(result).not.toContain('UPDATE');
        expect(result).toContain('CREATE TABLE T2');
    });

    it('strips DELETE statements', () => {
        const sql = `DELETE FROM T1 WHERE id = 1;`;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });

    it('strips EXEC/EXECUTE statements', () => {
        const sql = `EXEC sp_GetOrders;`;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });

    it('strips SET statements', () => {
        const sql = `SET NOCOUNT ON;`;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });

    it('strips USE statements', () => {
        const sql = `USE MyDatabase;`;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });

    it('strips GO batch separator', () => {
        const sql = `
            CREATE TABLE T1 (id INT);
            GO
        `;
        const result = extractStructuralDDL(sql);
        expect(result).toContain('CREATE TABLE T1');
        expect(result).not.toMatch(/^\s*GO\s*$/m);
    });

    it('strips PRINT statements', () => {
        const sql = `PRINT 'Hello';`;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });

    it('strips transaction commands', () => {
        const sql = `
            BEGIN TRANSACTION;
            COMMIT;
            ROLLBACK;
        `;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });

    it('strips GRANT/REVOKE/DENY', () => {
        const sql = `
            GRANT SELECT ON T1 TO user1;
            REVOKE INSERT ON T1 FROM user1;
            DENY DELETE ON T1 TO user1;
        `;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });

    it('strips DROP statements', () => {
        const sql = `
            DROP TABLE IF EXISTS T1;
            DROP INDEX IX_Temp;
        `;
        expect(extractStructuralDDL(sql).trim()).toBe('');
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
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
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
        const result = extractStructuralDDL(sql);
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
        expect(extractStructuralDDL('')).toBe('');
    });

    it('returns empty string for non-structural SQL', () => {
        const sql = `
            INSERT INTO T1 VALUES (1);
            UPDATE T1 SET x = 1;
            DELETE FROM T1;
        `;
        expect(extractStructuralDDL(sql).trim()).toBe('');
    });
});

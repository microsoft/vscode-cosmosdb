/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it } from 'vitest';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import {
    extractAccountNameFromEndpoint,
    getMigrationTelemetryProperties,
    maskMigrationApplicationDetails,
    setMigrationTelemetryContext,
} from './migrationTelemetry';

function createContext() {
    return {
        telemetry: {
            properties: {} as Record<string, string | undefined>,
            measurements: {} as Record<string, number | undefined>,
        },
        errorHandling: {
            issueProperties: {} as Record<string, string>,
            forceIncludeInReportIssueCommand: undefined as boolean | undefined,
        },
        valuesToMask: [] as string[],
    };
}

function createProject(overrides?: Partial<ProjectJson>): ProjectJson {
    return {
        version: 1,
        name: 'test',
        sourceCode: 'parent',
        sessionId: 'session-guid',
        runCounts: {},
        phases: { discovery: { status: 'not-started' } },
        ...overrides,
    };
}

describe('setMigrationTelemetryContext — run history', () => {
    it('does not invent a first-run index for an observation', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject(), 'discovery');
        expect(ctx.telemetry.measurements.runIndex).toBeUndefined();
    });

    it('does not use historical programmatic run counts for skill runs', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(
            ctx as unknown as IActionContext,
            createProject({ runCounts: { schemaConversion: 2 } }),
            'schemaConversion',
        );
        expect(ctx.telemetry.measurements.runIndex).toBeUndefined();
    });

    it('does not stamp runIndex when no phase is provided', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject());
        expect(ctx.telemetry.measurements.runIndex).toBeUndefined();
    });
});

describe('setMigrationTelemetryContext — context stamping', () => {
    it('is a no-op when no project is provided', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, undefined);
        expect(ctx.telemetry.properties).toEqual({});
        expect(ctx.telemetry.measurements).toEqual({});
        expect(ctx.valuesToMask).toEqual([]);
    });

    it('stamps sessionId, phase, hasCustomInstructions and sourceDbType', () => {
        const ctx = createContext();
        const project = createProject({
            phases: {
                discovery: {
                    status: 'not-started',
                    discoveryInstructions: 'be careful',
                    applicationAnalysis: { databaseType: 'PostgreSQL' },
                },
            },
        });
        setMigrationTelemetryContext(ctx as unknown as IActionContext, project, 'discovery', 'host-session');
        expect(ctx.telemetry.properties.sessionId).toBe('host-session');
        expect(ctx.telemetry.properties.phase).toBe('discovery');
        expect(ctx.telemetry.properties.hasCustomInstructions).toBe('true');
        expect(ctx.telemetry.properties.sourceDbType).toBe('PostgreSQL');
        expect(ctx.errorHandling.issueProperties.sessionId).toBe('host-session');
        expect(ctx.errorHandling.issueProperties.phase).toBe('discovery');
    });

    it('reports hasCustomInstructions=false when the phase has no instructions', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject(), 'discovery');
        expect(ctx.telemetry.properties.hasCustomInstructions).toBe('false');
    });

    it('masks all saved free-form application details without emitting their values', () => {
        const ctx = createContext();
        const applicationAnalysis = {
            projectName: 'private-app-name',
            projectType: 'private-type',
            language: 'private-language',
            frameworks: ['private-framework-a', 'private-framework-b'],
            databaseType: 'private-database',
            databaseAccess: 'private-access',
        };
        const project = createProject({
            phases: { discovery: { status: 'not-started', applicationAnalysis } },
        });
        setMigrationTelemetryContext(ctx as unknown as IActionContext, project, 'discovery');
        expect(ctx.valuesToMask).toEqual(expect.arrayContaining(Object.values(applicationAnalysis).flat()));
        expect(ctx.telemetry.properties.sourceDbType).toBe('other');
        expect(JSON.stringify([ctx.telemetry, ctx.errorHandling.issueProperties])).not.toContain('private-');
    });

    it('retains the safe normalized database dimension while masking other saved details', () => {
        const ctx = createContext();
        const project = createProject({
            phases: {
                discovery: {
                    status: 'not-started',
                    applicationAnalysis: {
                        projectName: 'private-app',
                        databaseType: 'PostgreSQL',
                    },
                },
            },
        });
        setMigrationTelemetryContext(ctx as unknown as IActionContext, project);
        expect(ctx.valuesToMask).toContain('private-app');
        expect(ctx.valuesToMask).not.toContain('PostgreSQL');
        expect(ctx.telemetry.properties.sourceDbType).toBe('PostgreSQL');
    });

    it('masks raw and trimmed update values without registering blank masks', () => {
        const ctx = createContext();
        maskMigrationApplicationDetails(ctx, {
            projectName: '  private-app  ',
            projectType: '',
            language: ' \n',
            frameworks: [' private-framework ', '', ' '],
            databaseType: 'PostgreSQL',
        });
        expect(ctx.valuesToMask).toEqual([
            '  private-app  ',
            'private-app',
            ' private-framework ',
            'private-framework',
            'PostgreSQL',
        ]);
    });

    it('stamps migrationMode when set', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject({ migrationMode: 'start' }));
        expect(ctx.telemetry.properties.migrationMode).toBe('start');
    });

    it('masks OII identifiers from error messages without emitting them as properties', () => {
        const ctx = createContext();
        const project = createProject({
            phases: {
                discovery: { status: 'not-started' },
                targetEnvironment: {
                    type: 'azure',
                    tenantId: 'tenant-1',
                    subscriptionId: 'sub-1',
                    accountName: 'my-account',
                    resourceGroup: 'my-rg',
                },
            },
        });
        setMigrationTelemetryContext(ctx as unknown as IActionContext, project, 'provisioning');
        expect(ctx.valuesToMask).toEqual(expect.arrayContaining(['sub-1', 'my-account', 'my-rg']));
        expect(ctx.valuesToMask).not.toContain('tenant-1');
        // None of these OII values should be emitted as telemetry properties here.
        const props = Object.values(ctx.telemetry.properties);
        expect(props).not.toContain('tenant-1');
        expect(props).not.toContain('sub-1');
        expect(props).not.toContain('my-rg');
    });

    it.each(['customer-secret', '__proto__', 'constructor'])(
        'normalizes untrusted database type %s',
        (databaseType) => {
            const ctx = createContext();
            const project = createProject({
                sessionId: 'stored-sensitive-id',
                phases: { discovery: { status: 'not-started', applicationAnalysis: { databaseType } } },
            });
            setMigrationTelemetryContext(ctx as unknown as IActionContext, project, 'discovery');
            expect(ctx.telemetry.properties.sourceDbType).toBe('other');
            expect(ctx.telemetry.properties.sessionId).toBeUndefined();
            expect(ctx.errorHandling.issueProperties.sessionId).toBeUndefined();
            expect(ctx.valuesToMask).toContain(databaseType);
        },
    );
});

describe('normalized Application Details dimensions', () => {
    type Details = NonNullable<ProjectJson['phases']['discovery']['applicationAnalysis']>;

    function properties(applicationAnalysis: Details) {
        return getMigrationTelemetryProperties(
            createProject({
                phases: { discovery: { status: 'not-started', applicationAnalysis } },
            }),
        );
    }

    it.each([
        [{ projectType: 'rest API' }, 'sourceProjectType', 'Web API'],
        [{ projectType: 'web_app; CLI' }, 'sourceProjectType', 'Console, Web application'],
        [{ language: ' ts, JS;typescript ' }, 'sourceLanguage', 'JavaScript, TypeScript'],
        [{ language: 'C SHARP, golang' }, 'sourceLanguage', 'C#, Go'],
        [{ language: 'Python 3.12; TypeScript v5.6' }, 'sourceLanguage', 'Python, TypeScript'],
        [
            { frameworks: ['EF Core', 'SpringBoot', 'Entity Framework Core 8.0'] },
            'sourceFramework',
            'Entity Framework Core, Spring Boot',
        ],
        [{ frameworks: ['react.js', 'Express.js; React 19'] }, 'sourceFramework', 'Express, React'],
        [{ databaseAccess: 'Entity Framework Core, Dapper;raw sql' }, 'sourceDbAccess', 'Direct SQL, Micro ORM, ORM'],
        [{ databaseAccess: 'ADO NET; JDBC driver;knex.js' }, 'sourceDbAccess', 'ADO.NET, JDBC, Query builder'],
        [{ databaseType: 'mssql, postgres' }, 'sourceDbType', 'PostgreSQL, SQL Server'],
    ] satisfies [Details, string, string][])('normalizes %j to fixed labels', (input, key, expected) => {
        expect(properties(input)[key]).toBe(expected);
    });

    it.each([
        ['athena', 'Athena'],
        ['bigquery', 'BigQuery'],
        ['clickhouse', 'ClickHouse'],
        ['databricks', 'Databricks'],
        ['dax', 'DAX'],
        ['doris', 'Doris'],
        ['dremio', 'Dremio'],
        ['drill', 'Drill'],
        ['druid', 'Druid'],
        ['duckdb', 'DuckDB'],
        ['dune', 'Dune'],
        ['exasol', 'Exasol'],
        ['fabric', 'Fabric'],
        ['hive', 'Hive'],
        ['materialize', 'Materialize'],
        ['mysql', 'MySQL'],
        ['oracle', 'Oracle'],
        ['postgres', 'PostgreSQL'],
        ['presto', 'Presto'],
        ['prql', 'PRQL'],
        ['redshift', 'Redshift'],
        ['risingwave', 'RisingWave'],
        ['snowflake', 'Snowflake'],
        ['solr', 'Solr'],
        ['spark', 'Spark'],
        ['spark2', 'Spark'],
        ['sqlite', 'SQLite'],
        ['starrocks', 'StarRocks'],
        ['tableau', 'Tableau'],
        ['teradata', 'Teradata'],
        ['trino', 'Trino'],
        ['tsql', 'SQL Server'],
    ])('covers SQLGlot dialect %s as %s', (dialect, expected) => {
        expect(properties({ databaseType: dialect }).sourceDbType).toBe(expected);
    });

    it.each([
        ['Microsoft SQL Server', 'SQL Server'],
        ['T-SQL', 'SQL Server'],
        ['Azure SQL Database', 'SQL Server'],
        ['Azure SQL Managed Instance', 'SQL Server'],
        ['Azure Database for PostgreSQL', 'PostgreSQL'],
        ['Amazon Aurora MySQL', 'MySQL'],
        ['MariaDB', 'MariaDB'],
        ['IBM DB2', 'DB2'],
        ['Amazon Athena', 'Athena'],
        ['Google BigQuery', 'BigQuery'],
        ['Apache Spark 3.5', 'Spark'],
        ['Microsoft Fabric Warehouse', 'Fabric'],
        ['Databricks SQL', 'Databricks'],
    ])('normalizes database product name %s to %s', (input, expected) => {
        expect(properties({ databaseType: input }).sourceDbType).toBe(expected);
    });

    it.each(['custom-customer-dialect', 'Snowflake for customer-a', 'private-cluster.example.com'])(
        'keeps unrecognized database labels %s private',
        (input) => {
            expect(properties({ databaseType: input }).sourceDbType).toBe('other');
            const context = createContext();
            maskMigrationApplicationDetails(context, { databaseType: input }, { preserveNormalizedDimensions: true });
            expect(context.valuesToMask).toContain(input);
        },
    );

    it('never copies unknown categories, versions, or project names into emitted dimensions', () => {
        const result = properties({
            projectName: 'private-project',
            projectType: 'private-type',
            language: 'Python 5551234567; private-language',
            frameworks: ['Django for private-service', 'private-framework', 'React'],
            databaseAccess: 'private-driver',
        });
        expect(result).toEqual({
            sourceProjectType: 'other',
            sourceLanguage: 'Python, other',
            sourceFramework: 'React, other',
            sourceDbAccess: 'other',
        });
        expect(JSON.stringify(result)).not.toMatch(/private-|5551234567/);
    });

    it.each(['constructor', '__proto__', 'TypeScript for private-app', 'C# (private-account)', ';'])(
        'does not mistake arbitrary input %s for an allowlisted category',
        (input) => {
            expect(
                properties({ projectType: input, language: input, frameworks: [input], databaseAccess: input }),
            ).toEqual({
                sourceProjectType: 'other',
                sourceLanguage: 'other',
                sourceFramework: 'other',
                sourceDbAccess: 'other',
            });
        },
    );

    it('omits missing and blank categories instead of inventing values', () => {
        expect(properties({ projectType: ' ', language: '', frameworks: [' ', ''], databaseAccess: '' })).toEqual({});
        expect(properties({ frameworks: [] })).toEqual({});
    });

    it('deduplicates and sorts categories independently of input order', () => {
        expect(properties({ frameworks: ['React', 'django', 'REACT', 'private-a', 'private-b'] })).toEqual(
            properties({ frameworks: ['unknown-app', 'Django', 'react.js'] }),
        );
    });

    it('preserves normalized dimensions while masking names, versioned text and unknown list entries', () => {
        const context = createContext();
        const applicationAnalysis = {
            projectName: 'private-name',
            projectType: 'Web API',
            language: 'Python 5551234567, private-language',
            frameworks: ['EF Core', ' private-framework '],
            databaseAccess: 'Entity Framework Core',
        };
        const p = createProject({ phases: { discovery: { status: 'not-started', applicationAnalysis } } });
        setMigrationTelemetryContext(context as unknown as IActionContext, p);
        expect(context.telemetry.properties).toMatchObject({
            sourceProjectType: 'Web API',
            sourceLanguage: 'Python, other',
            sourceFramework: 'Entity Framework Core, other',
            sourceDbAccess: 'ORM',
        });
        expect(context.valuesToMask).toEqual(
            expect.arrayContaining([
                'private-name',
                'Python 5551234567',
                'private-language',
                'Python 5551234567, private-language',
                ' private-framework ',
                'private-framework',
            ]),
        );
        for (const label of ['Web API', 'Python', 'Entity Framework Core', 'ORM', 'other']) {
            expect(context.valuesToMask).not.toContain(label);
        }
        expect(context.errorHandling.issueProperties).toMatchObject(context.telemetry.properties);
    });

    it('still masks recognized category inputs on manual-update contexts', () => {
        const context = createContext();
        maskMigrationApplicationDetails(context, {
            projectType: 'Web API',
            language: 'Python',
            frameworks: ['Django'],
            databaseAccess: 'ORM',
        });
        expect(context.valuesToMask).toEqual(['Web API', 'Python', 'Django', 'ORM']);
    });
});

describe('extractAccountNameFromEndpoint', () => {
    it('returns the first subdomain of a Cosmos endpoint', () => {
        expect(extractAccountNameFromEndpoint('https://myaccount.documents.azure.com:443/')).toBe('myaccount');
    });

    it('returns the hostname when there is no dot', () => {
        expect(extractAccountNameFromEndpoint('http://localhost:8081/')).toBe('localhost');
    });

    it('returns undefined for an unparseable endpoint', () => {
        expect(extractAccountNameFromEndpoint('not a url')).toBeUndefined();
    });
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ProjectJson } from '../../../services/MigrationProjectService';

export type MigrationPhaseKey =
    | 'preflight'
    | 'discovery'
    | 'assessment'
    | 'schemaConversion'
    | 'provisioning'
    | 'codeMigration';

function categoryKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(/[\s_-]+/g, '');
}

function categories(values: Record<string, readonly string[]>): ReadonlyMap<string, string> {
    return new Map(
        Object.entries(values).flatMap(([label, aliases]) =>
            [label, ...aliases].map((alias) => [categoryKey(alias), label] as const),
        ),
    );
}

const applicationDimensions = {
    projectType: {
        property: 'sourceProjectType',
        categories: categories({
            'Web API': ['api', 'rest api', 'restful api', 'asp.net web api', 'asp.net core web api'],
            'Web application': ['web app', 'website', 'web'],
            Service: ['backend', 'backend service'],
            Microservices: ['microservice'],
            Worker: ['background service', 'background worker', 'worker service'],
            Console: ['console app', 'console application', 'cli', 'command line'],
            Library: ['class library', 'package', 'sdk'],
            Desktop: ['desktop app', 'desktop application'],
            Mobile: ['mobile app', 'mobile application'],
            Serverless: ['function app', 'azure functions', 'lambda'],
            'Data pipeline': ['etl', 'batch', 'batch job'],
            Frontend: ['front end', 'spa', 'single page application'],
            'Full stack': ['full stack application'],
            Monolith: ['monolithic application'],
        }),
    },
    language: {
        property: 'sourceLanguage',
        categories: categories({
            'C#': ['csharp', 'c sharp'],
            'F#': ['fsharp', 'f sharp'],
            'Visual Basic': ['vb', 'vb.net', 'visual basic .net'],
            JavaScript: ['js', 'ecmascript'],
            TypeScript: ['ts'],
            Python: ['py'],
            Java: [],
            Kotlin: [],
            Scala: [],
            Go: ['golang'],
            Ruby: [],
            PHP: [],
            Rust: [],
            'C++': ['cpp', 'cplusplus'],
            C: [],
            Swift: [],
            'Objective-C': ['objc', 'objective c'],
            Dart: [],
            Elixir: [],
            Erlang: [],
            R: [],
            PowerShell: ['pwsh'],
            SQL: ['t-sql', 'tsql', 'pl/sql'],
        }),
    },
    frameworks: {
        property: 'sourceFramework',
        categories: categories({
            '.NET': ['dotnet', '.net framework', '.net core'],
            'ASP.NET': ['aspnet', 'asp.net mvc'],
            'ASP.NET Core': ['aspnet core', 'aspnetcore'],
            'Entity Framework': ['ef'],
            'Entity Framework Core': ['ef core', 'efcore'],
            Dapper: [],
            Spring: ['spring framework'],
            'Spring Boot': ['springboot'],
            Hibernate: [],
            'Jakarta EE': ['java ee'],
            Django: [],
            Flask: [],
            FastAPI: [],
            SQLAlchemy: ['sql alchemy'],
            Express: ['express.js', 'expressjs'],
            NestJS: ['nest.js'],
            'Next.js': ['nextjs'],
            React: ['react.js', 'reactjs'],
            Angular: ['angularjs'],
            Vue: ['vue.js', 'vuejs'],
            Svelte: [],
            Sequelize: [],
            TypeORM: [],
            Prisma: [],
            Knex: ['knex.js'],
            'Ruby on Rails': ['rails'],
            'Active Record': ['activerecord'],
            Laravel: [],
            Symfony: [],
            Eloquent: [],
            GORM: [],
            Diesel: [],
        }),
    },
    databaseType: {
        property: 'sourceDbType',
        // Keep named SQLGlot dialects covered without trusting runtime/custom dialect identifiers.
        // https://github.com/tobymao/sqlglot/blob/main/sqlglot/dialects/dialect.py
        categories: categories({
            PostgreSQL: ['postgres', 'azure database for postgresql', 'aurora postgresql', 'amazon aurora postgresql'],
            MySQL: ['azure database for mysql', 'aurora mysql', 'amazon aurora mysql'],
            MariaDB: [],
            'SQL Server': [
                'mssql',
                'tsql',
                't-sql',
                'microsoft sql server',
                'azure sql',
                'azure sql database',
                'azure sql managed instance',
            ],
            Oracle: ['oracle database'],
            SQLite: [],
            DB2: ['ibm db2'],
            Athena: ['amazon athena', 'aws athena'],
            BigQuery: ['google bigquery', 'google cloud bigquery'],
            ClickHouse: [],
            Databricks: ['databricks sql'],
            DAX: ['data analysis expressions'],
            Doris: ['apache doris'],
            Dremio: [],
            Drill: ['apache drill'],
            Druid: ['apache druid'],
            DuckDB: [],
            Dune: ['dunesql', 'dune sql'],
            Exasol: [],
            Fabric: ['microsoft fabric', 'fabric warehouse', 'microsoft fabric warehouse'],
            Hive: ['apache hive'],
            Materialize: [],
            Presto: ['prestodb'],
            PRQL: [],
            Redshift: ['amazon redshift', 'aws redshift'],
            RisingWave: [],
            Snowflake: [],
            Solr: ['apache solr'],
            Spark: ['spark2', 'apache spark', 'spark sql', 'apache spark sql'],
            StarRocks: [],
            Tableau: [],
            Teradata: [],
            Trino: [],
        }),
    },
    databaseAccess: {
        property: 'sourceDbAccess',
        categories: categories({
            ORM: [
                'object relational mapping',
                'object relational mapper',
                'entity framework',
                'ef',
                'entity framework core',
                'ef core',
                'efcore',
                'hibernate',
                'jpa',
                'spring data jpa',
                'django orm',
                'sqlalchemy',
                'active record',
                'activerecord',
                'prisma',
                'sequelize',
                'typeorm',
                'eloquent',
                'gorm',
                'diesel',
            ],
            'Micro ORM': ['micro-orm', 'dapper'],
            'Query builder': ['knex', 'knex.js', 'jooq'],
            'Direct SQL': ['sql', 'raw sql', 'sql queries', 'direct queries', 'native sql'],
            'Stored procedures': ['stored procedure', 'sprocs'],
            JDBC: ['jdbc driver', 'spring jdbc'],
            ODBC: ['odbc driver', 'pyodbc'],
            'ADO.NET': ['ado.net driver', 'ado net', 'adonet'],
            'Native driver': [
                'database driver',
                'native sdk',
                'psycopg',
                'psycopg2',
                'npgsql',
                'mysql2',
                'node-postgres',
            ],
            'HTTP API': ['rest', 'rest api', 'http', 'graphql'],
        }),
    },
} as const;

export const migrationApplicationTelemetryKeys = Object.values(applicationDimensions).map(
    (dimension) => dimension.property,
);

type ApplicationDimension = keyof typeof applicationDimensions;

function normalizeCategory(
    value: unknown,
    labels: ReadonlyMap<string, string>,
): { value: string | undefined; sensitiveValues: string[] } {
    const normalized = new Set<string>();
    const sensitiveValues = new Set<string>();
    for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item !== 'string' || !item.trim()) continue;
        let sensitive = false;
        const tokens = item
            .split(/[,;]/u)
            .map((part) => part.trim())
            .filter(Boolean);
        if (!tokens.length) {
            normalized.add('other');
            sensitive = true;
        }
        for (const token of tokens) {
            const key = categoryKey(token);
            const exactLabel = key === 'other' ? 'other' : labels.get(key);
            const label = exactLabel ?? labels.get(categoryKey(token.replace(/\s+v?\d+(?:\.\d+)*(?:\.x)?$/iu, '')));
            normalized.add(label ?? 'other');
            if (!exactLabel) {
                sensitive = true;
                sensitiveValues.add(token);
            }
        }
        if (sensitive) {
            sensitiveValues.add(item);
            sensitiveValues.add(item.trim());
        }
    }
    return {
        value: normalized.size ? [...normalized].sort().join(', ') : undefined,
        sensitiveValues: [...sensitiveValues],
    };
}

/** Returns bounded migration dimensions; no file contents, paths, or names are emitted. */
export function getMigrationTelemetryProperties(
    project: ProjectJson | undefined,
    phase?: MigrationPhaseKey,
): Record<string, string> {
    const properties: Record<string, string> = {};
    if (phase) {
        properties.phase = phase;
        properties.hasCustomInstructions = String(!!project && getHasCustomInstructions(project, phase));
    }
    if (project?.migrationMode === 'plan' || project?.migrationMode === 'start') {
        properties.migrationMode = project.migrationMode;
    }
    const details = project?.phases.discovery.applicationAnalysis;
    for (const key of Object.keys(applicationDimensions) as ApplicationDimension[]) {
        const dimension = applicationDimensions[key];
        const normalized = normalizeCategory(details?.[key], dimension.categories);
        if (normalized.value) properties[dimension.property] = normalized.value;
    }
    return properties;
}

/** Registers free-form application details for error masking; no file contents, paths, or names are emitted. */
export function maskMigrationApplicationDetails(
    context: Pick<IActionContext, 'valuesToMask'>,
    details: unknown,
    options: { preserveNormalizedDimensions?: boolean } = {},
): void {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return;
    const fields = details as Record<string, unknown>;
    for (const key of ['projectName', 'projectType', 'language', 'frameworks', 'databaseType', 'databaseAccess']) {
        const value = fields[key];
        if (options.preserveNormalizedDimensions && Object.hasOwn(applicationDimensions, key)) {
            context.valuesToMask.push(
                ...normalizeCategory(value, applicationDimensions[key as ApplicationDimension].categories)
                    .sensitiveValues,
            );
            continue;
        }
        for (const item of Array.isArray(value) ? value : [value]) {
            if (typeof item !== 'string' || !item.trim()) continue;
            context.valuesToMask.push(item);
            if (item !== item.trim()) context.valuesToMask.push(item.trim());
        }
    }
}

/**
 * Stamps shared migration telemetry context on an `IActionContext`.
 * Call at the top of every `callWithTelemetryAndErrorHandling` in migration code.
 */
export function setMigrationTelemetryContext(
    context: IActionContext,
    project: ProjectJson | undefined,
    phase?: MigrationPhaseKey,
    sessionId?: string,
): void {
    if (!project) return;

    const properties = getMigrationTelemetryProperties(project, phase);
    if (sessionId) properties.sessionId = sessionId;
    Object.assign(context.telemetry.properties, properties);
    Object.assign(context.errorHandling.issueProperties, properties);
    maskMigrationApplicationDetails(context, project.phases.discovery.applicationAnalysis, {
        preserveNormalizedDimensions: true,
    });

    // OII identifiers are emitted as-is under their predefined property names
    // (`subscriptionId`, `accountName`), but should still be redacted from accompanying errors.
    const targetEnv = project.phases.targetEnvironment;
    if (targetEnv?.subscriptionId) {
        context.valuesToMask.push(targetEnv.subscriptionId);
    }
    const targetAccountName =
        targetEnv?.accountName ||
        (targetEnv?.endpoint ? extractAccountNameFromEndpoint(targetEnv.endpoint) : undefined);
    if (targetAccountName) {
        context.valuesToMask.push(targetAccountName);
    }
    if (targetEnv?.resourceGroup) {
        context.valuesToMask.push(targetEnv.resourceGroup);
    }
    for (const value of [project.name, project.sessionId, targetEnv?.endpoint]) {
        if (value?.trim()) context.valuesToMask.push(value);
    }
}

/**
 * Extracts the account name from a Cosmos DB endpoint URL.
 * The account name is always the first subdomain.
 * E.g., `https://myaccount.documents.azure.com:443/` → `myaccount`
 */
export function extractAccountNameFromEndpoint(endpoint: string): string | undefined {
    try {
        const url = new URL(endpoint);
        const hostname = url.hostname;
        const firstDot = hostname.indexOf('.');
        if (firstDot > 0) {
            return hostname.substring(0, firstDot);
        }
        return hostname || undefined;
    } catch {
        return undefined;
    }
}

function getHasCustomInstructions(project: ProjectJson, phase: MigrationPhaseKey): boolean {
    switch (phase) {
        case 'preflight':
        case 'discovery':
            return !!(project.migrationInstructions || project.phases.discovery.discoveryInstructions);
        case 'assessment':
            return !!(project.migrationInstructions || project.phases.assessment?.assessmentInstructions);
        case 'schemaConversion':
            return !!(project.migrationInstructions || project.phases.schemaConversion?.schemaConversionInstructions);
        case 'provisioning':
        case 'codeMigration':
            return !!project.migrationInstructions;
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sourceFieldId } from '../../skills/cosmosdb-migration/scripts/source-contract.mjs';
import { sourceFilesHash } from '../../skills/cosmosdb-migration/scripts/validate-source-evidence.mjs';

// An offline positive control built from the reviewed DDL facts, never from a trial submission.
export function reviewedDdlV2(legacy) {
    const files = legacy.files.map((file) => ({
        ...file,
        kind: 'ddl',
        disposition: 'used',
        rationale: 'Selected authoritative DDL.',
        provenance: { method: 'supplied', scope: 'schema export' },
    }));
    const evidence = files.map(({ path }) => path);
    const property = (name) => [{ kind: 'property', name }];
    const fields = (columns) => columns.map((name) => sourceFieldId(property(name)));
    const datasets = legacy.tables.map((table) => ({
        id: table.name,
        name: table.name,
        kind: 'relational',
        evidence,
        coverage: { basis: 'declared', complete: true, scope: 'supplied DDL only', sampling: null },
        fields: table.columns.map((column) => ({
            id: sourceFieldId(property(column.name)),
            path: property(column.name),
            nativeTypes: [column.type],
            presence: 'required',
            nullable: typeof column.nullable === 'boolean' ? column.nullable : null,
            evidence,
        })),
        identities: table.primaryKey.length
            ? [{ id: 'pk', kind: 'primary', fields: fields(table.primaryKey), scope: table.name, evidence }]
            : [],
        relational: {
            ...table,
            uniqueConstraints: [],
            checks: [],
            defaults: [],
            behaviors: [],
            indexes: (legacy.indexes ?? [])
                .filter((index) => index.table === table.name)
                .map(({ name, unique, keys }) => ({
                    name,
                    unique,
                    columns: keys.map((column) => ({ name: column, direction: 'ascending' })),
                })),
        },
    }));
    const engine = 'SQL Server';
    return {
        version: 2,
        dialect: legacy.dialect,
        parser: legacy.parser,
        source: {
            engine,
            version: null,
            namespaces: [...new Set(legacy.tables.map((t) => t.identity[0].name))],
            capabilities: [],
        },
        files,
        sha256: sourceFilesHash(engine, files),
        datasets,
        relationships: legacy.tables.flatMap((table) =>
            table.foreignKeys.map((key) => ({
                id: key.name,
                constraintName: key.name,
                kind: 'foreign-key',
                from: { dataset: table.name, fields: fields(key.columns) },
                to: { dataset: key.referencedTable, fields: fields(key.referencedColumns) },
                evidence,
            })),
        ),
        semantics: [],
        errors: [],
    };
}

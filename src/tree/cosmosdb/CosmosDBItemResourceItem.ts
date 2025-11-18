/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBRecordIdentifier } from '../../cosmosdb/types/queryResult';
import { extractPartitionKey, getDocumentId } from '../../utils/document';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type CosmosDBItemModel } from './models/CosmosDBItemModel';

/**
 * Sanitize the id of a Cosmos DB tree item so it can be safely used in a query string.
 * Learn more at: https://github.com/ljharb/qs#rfc-3986-and-rfc-1738-space-encoding
 */
export function sanitizeId(id: string): string {
    return id.replace(/\+/g, ' ');
}

export abstract class CosmosDBItemResourceItem
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.document';
    public readonly documentId?: CosmosDBRecordIdentifier;

    protected constructor(
        public readonly model: CosmosDBItemModel,
        public readonly experience: Experience,
    ) {
        this.documentId = getDocumentId(this.model.item, this.model.container.partitionKey);
        const uniqueId = this.generateUniqueId();
        this.id = sanitizeId(
            `${model.accountInfo.id}/${model.database.id}/${model.container.id}/documents/${uniqueId}`,
        );
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('file'),
            label: getDocumentTreeItemLabel(this.model.item),
            tooltip: new vscode.MarkdownString(this.generateCompactTooltip()),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: l10n.t('Open Item'),
                command: 'cosmosDB.openDocument',
                arguments: [this],
            },
        };
    }

    private generateCompactTooltip(): string {
        const doc = this.model.item ?? {};
        const id: string = (doc.id as string | undefined) ?? (doc._id as string | undefined) ?? '<no id>';

        const pkPaths = this.model.container.partitionKey?.paths ?? [];
        const pkValuesRaw = this.getPartitionKeyValuesArray(this.model);

        const lines: string[] = [];

        // ID section
        lines.push(`**ID:** ${id}`);

        // Partition Key section
        if (pkPaths.length > 0) {
            lines.push('');

            if (pkPaths.length === 1) {
                const path = pkPaths[0];
                const raw = pkValuesRaw[0];
                lines.push('#### Partition Key');
                lines.push(`${path}: ${this.formatValue(raw)}`);
            } else {
                lines.push('#### Partition Keys');

                for (let i = 0; i < pkPaths.length; i++) {
                    const path = pkPaths[i];
                    const raw = pkValuesRaw[i];
                    lines.push(`  \`${path}\`: ${this.formatValue(raw)}`);
                }
            }
        }

        // Metadata section - system fields only
        const metadataFields: Array<{ key: string; label: string }> = [
            { key: '_rid', label: 'RID' },
            { key: '_etag', label: 'ETag' },
            { key: '_ts', label: 'TS' },
        ];

        if (metadataFields.length > 0) {
            lines.push(``);
            lines.push(`| Item | Value |`);
            lines.push(`|:---|:---|`);
            for (const { key, label } of metadataFields) {
                const value = doc[key] as string | number | undefined;
                if (value !== undefined && value !== null) {
                    lines.push(`|${label}|${value}|`);
                }
            }
        }

        return lines.join('\n');
    }

    private getPartitionKeyValuesArray(model: CosmosDBItemModel): unknown[] {
        if (!model.container.partitionKey || model.container.partitionKey.paths.length === 0) {
            return [];
        }
        const partitionKeyValues = extractPartitionKey(model.item, model.container.partitionKey);
        return Array.isArray(partitionKeyValues) ? partitionKeyValues : [partitionKeyValues];
    }

    private formatValue(value: unknown): string {
        if (value === null) {
            return '`null`';
        }
        if (value === undefined) {
            return '`undefined`';
        }
        if (typeof value === 'object') {
            try {
                const json = JSON.stringify(value);
                // Truncate long objects
                if (json.length > 100) {
                    return '`' + json.substring(0, 97) + '…`';
                }
                return '`' + json + '`';
            } catch {
                return '`[object]`';
            }
        }
        if (typeof value === 'string') {
            // Truncate long strings
            if (value.length > 100) {
                return `"${value.substring(0, 97)}…"`;
            }
            return `"${value}"`;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        // For any other type (symbol, function, etc.), use JSON or fallback
        try {
            return '`' + JSON.stringify(value) + '`';
        } catch {
            return '`[unknown]`';
        }
    }

    /**
     * Warning: This method is used to generate a unique ID for the document tree item.
     * It is not used to generate the actual document ID.
     */
    protected generateUniqueId(): string {
        const id = this.documentId?.id;
        const rid = this.documentId?._rid;
        const partitionKeyValues = this.generatePartitionKeyValue(this.model);

        return `${id || '<empty id>'}|${partitionKeyValues || '<empty partition key>'}|${rid || '<empty rid>'}`;
    }

    /**
     * Warning: This method is used to generate a partition key value for the document tree item.
     * It is not used to generate the actual partition key value.
     */
    protected generatePartitionKeyValue(model: CosmosDBItemModel): string {
        if (!model.container.partitionKey || model.container.partitionKey.paths.length === 0) {
            return '';
        }

        let partitionKeyValues = extractPartitionKey(model.item, model.container.partitionKey);
        partitionKeyValues = Array.isArray(partitionKeyValues) ? partitionKeyValues : [partitionKeyValues];
        partitionKeyValues = partitionKeyValues
            .map((v) => {
                if (v === null) {
                    return '\\<null>';
                }
                if (v === undefined) {
                    return '\\<undefined>';
                }
                if (typeof v === 'object') {
                    return JSON.stringify(v);
                }
                return v;
            })
            .join(', ');

        return partitionKeyValues;
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBHiddenFields } from '../../constants';
import { type CosmosDBRecordIdentifier } from '../../cosmosdb/types/queryResult';
import { truncateString } from '../../utils/convertors';
import { extractPartitionKey, getDocumentId } from '../../utils/document';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { renderAsCodeBlock } from '../../utils/sanitization';
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
            tooltip: new vscode.MarkdownString(this.generateTooltip()),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: l10n.t('Open Item'),
                command: 'cosmosDB.openDocument',
                arguments: [this],
            },
        };
    }

    /**
     * Maximum number of property rows to show in the tooltip (including ID and partition keys)
     */
    private static readonly MAX_TOOLTIP_ROWS = 12;
    private static readonly MAX_VALUE_LENGTH = 50;

    private generateTooltip(): string {
        const doc = this.model.item ?? {};
        const id: string = (doc.id as string | undefined) ?? (doc._id as string | undefined) ?? '<no id>';

        const pkPaths = this.model.container.partitionKey?.paths ?? [];
        const pkValuesRaw = this.getPartitionKeyValuesArray(this.model);

        const pkFieldNames = new Set(pkPaths.map((p) => p.replace(/^\//, '')));
        const lines: string[] = [];

        // ID on its own line - use renderAsCodeBlock to prevent injection
        // Table header
        lines.push(`| | |`);
        lines.push(`|--|--|`);
        lines.push(`|**id**|${renderAsCodeBlock(truncateString(id, CosmosDBItemResourceItem.MAX_VALUE_LENGTH))}|`);
        // Partition key rows (italic keys)
        for (let i = 0; i < pkPaths.length; i++) {
            const fieldName = pkPaths[i].replace(/^\//, '');
            lines.push(`|*/${fieldName}*|${this.formatValue(pkValuesRaw[i])}|`);
        }

        // Other properties (excluding id, partition keys, and metadata)
        const otherKeys = Object.keys(doc).filter(
            (key) => key !== 'id' && !pkFieldNames.has(key) && !CosmosDBHiddenFields.includes(key),
        );

        for (const key of otherKeys) {
            if (lines.length - 4 >= CosmosDBItemResourceItem.MAX_TOOLTIP_ROWS) {
                lines.push(`|…|…|`);
                break;
            }
            lines.push(`|${key}|${this.formatValue(doc[key])}|`);
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

    /**
     * Safely formats a value for display in a markdown tooltip.
     * Uses renderAsCodeBlock to prevent markdown injection and XSS attacks.
     */
    private formatValue(value: unknown): string {
        if (value === null) {
            return renderAsCodeBlock('null');
        }
        if (value === undefined) {
            return renderAsCodeBlock('undefined');
        }
        if (typeof value === 'object') {
            try {
                const json = truncateString(JSON.stringify(value), CosmosDBItemResourceItem.MAX_VALUE_LENGTH);
                return renderAsCodeBlock(json);
            } catch {
                return renderAsCodeBlock('[object]');
            }
        }
        if (typeof value === 'string') {
            const truncatedValue = truncateString(value, CosmosDBItemResourceItem.MAX_VALUE_LENGTH);
            return renderAsCodeBlock(truncatedValue);
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            // Wrap numbers and booleans in code blocks for consistency and security
            return renderAsCodeBlock(String(value));
        }
        // For any other type (symbol, function, etc.), use JSON or fallback
        try {
            return renderAsCodeBlock(JSON.stringify(value));
        } catch {
            return renderAsCodeBlock('[unknown]');
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

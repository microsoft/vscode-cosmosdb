/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { Grid, type IColumnConfig, type IRow, Willow } from '@svar-ui/react-grid';
import '@svar-ui/react-grid/all.css';
import * as l10n from '@vscode/l10n';
import { useMemo } from 'react';
import './vscodeTheme.css';

const useStyles = makeStyles({
    wrapper: {
        height: '100%',
        width: '100%',
        '& .wx-willow-theme, & .wx-willow-dark-theme': {
            height: '100%',
        },
    },
    container: {
        height: '100%',
        width: '100%',
    },
});

type ResultTabViewTreeProps = {
    data: TreeData[];
};

// Input data type from SlickGrid format (flat with parentId)
interface TreeData {
    id: string;
    documentId?: unknown;
    parentId: string | null;
    field: string;
    value: string;
    type: string;
}

interface TreeDataItem extends IRow {
    id: number;
    data?: TreeDataItem[]; // Nested children array for SVAR tree
    open?: boolean;
    __rawData: TreeData; // Original data reference
}

// Convert flat parentId structure to SVAR nested data array structure
const convertToTreeData = (flatData: TreeData[]): TreeDataItem[] => {
    // Build a map for quick lookup
    const itemMap = new Map<string, TreeDataItem>();
    const result: TreeDataItem[] = [];
    let idCounter = 1; // Start IDs from 1

    // First pass: create all items with new numeric IDs
    flatData.forEach((item) => {
        const treeItem: TreeDataItem = {
            id: idCounter++,
            open: false,
            __rawData: item,
        };
        itemMap.set(item.id, treeItem);
    });

    // Second pass: build the tree structure
    flatData.forEach((item) => {
        const treeItem = itemMap.get(item.id)!;

        if (item.parentId === null) {
            // Root item
            result.push(treeItem);
        } else {
            // Child item - add to parent's data array
            const parent = itemMap.get(item.parentId);
            if (parent) {
                if (!parent.data) {
                    parent.data = [];
                }
                parent.data.push(treeItem);
            }
        }
    });

    return result;
};

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
    const styles = useStyles();

    // Define columns for tree view (Field, Value, Type)
    const columnsDef = useMemo(
        (): IColumnConfig[] => [
            {
                id: 'id_field',
                header: l10n.t('Field'),
                width: 200,
                resize: true,
                sort: true,
                flexgrow: 2,
                treetoggle: true, // Enable tree toggle on this column
                template: (value: string) => {
                    return `${value}`;
                },
                getter: (obj: TreeDataItem) => obj.__rawData.field,
            },
            {
                id: 'id_value',
                header: l10n.t('Value'),
                width: 300,
                resize: true,
                flexgrow: 1,
                getter: (obj: TreeDataItem) => obj.__rawData.value,
            },
            {
                id: 'id_type',
                header: l10n.t('Type'),
                width: 100,
                resize: true,
                flexgrow: 1,
                getter: (obj: TreeDataItem) => obj.__rawData.type,
            },
        ],
        [],
    );

    // Convert data to SVAR nested tree format
    const treeData = useMemo((): TreeDataItem[] => {
        return convertToTreeData(data);
    }, [data]);

    return (
        <div className={styles.wrapper}>
            <Willow>
                <div className={styles.container}>
                    <Grid
                        columns={columnsDef}
                        data={treeData}
                        tree={true}
                        select={true}
                        multiselect={true}
                        reorder={false}
                        autoConfig={false}
                        header={true}
                    />
                </div>
            </Willow>
        </div>
    );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Label,
    Link,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import type React from 'react';

interface IndexMetricsSection {
    title: string;
    indexes: { [key: string]: string }[];
}

interface IndexMetrics {
    title: string;
    sections: IndexMetricsSection[];
}

const INDEX_METRICS_DOC_URL = 'https://learn.microsoft.com/azure/cosmos-db/nosql/index-metrics';

export const IndexMetricsView: React.FC<{ indexMetricsStr: string; topLabelStyle?: string }> = ({
    indexMetricsStr,
    topLabelStyle,
}) => {
    // TODO Uncomment this example for testing
    //indexMetricsStr = "Index Utilization Information\n  Utilized Single Indexes\n    Index Spec: /name/?\n    Index Impact Score: High\n    ---\n    Index Spec: /age/?\n    Index Impact Score: High\n    ---\n    Index Spec: /town/?\n    Index Impact Score: High\n    ---\n    Index Spec: /timestamp/?\n    Index Impact Score: High\n    ---\n  Potential Single Indexes\n  Utilized Composite Indexes\n  Potential Composite Indexes\n    Index Spec: /name ASC, /town ASC, /age ASC\n    Index Impact Score: High\n    ---\n    Index Spec: /name ASC, /town ASC, /timestamp ASC\n    Index Impact Score: High\n    ---"
    const parsed = parseIndexMetrics(indexMetricsStr);
    const columns = [l10n.t('Index Spec'), l10n.t('Index Impact Score')];

    return (
        <>
            <div className={topLabelStyle}>
                <Label size={'large'}>{parsed.title}</Label> (
                <Link href={INDEX_METRICS_DOC_URL} arial-label={l10n.t('Learn more about index metrics…')}>
                    {l10n.t('Learn more…')}
                </Link>
                )
            </div>

            <Table arial-label={l10n.t('Index metrics table')} style={{ minWidth: '510px' }}>
                <TableHeader>
                    <TableRow>
                        <TableHeaderCell>{l10n.t('Metric')}</TableHeaderCell>
                        <TableHeaderCell>
                            <Table>
                                <TableBody>
                                    <TableRow style={{ borderBottom: '0px' }}>
                                        {columns.map((column) => (
                                            <TableCell key={column}>{column}</TableCell>
                                        ))}
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableHeaderCell>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {parsed.sections.map((section) => (
                        <TableRow key={section.title}>
                            <TableCell>{section.title}</TableCell>
                            <TableCell>
                                {section.indexes && section.indexes.length > 0 ? (
                                    <Table>
                                        <TableBody>
                                            {section.indexes.map((cosmosdbIndex, index) => (
                                                <TableRow
                                                    key={index}
                                                    {...(index === section.indexes.length - 1
                                                        ? { style: { borderBottom: '0px' } }
                                                        : {})}
                                                >
                                                    {columns.map((column) => (
                                                        <TableCell>{cosmosdbIndex[column]}</TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    '-'
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </>
    );
};

/**
Parse the indexMetricsStr and display the following information in a table format:
Index Utilization Information
  Utilized Single Indexes
    Index Spec: /type/?
    Index Impact Score: High
    ---
  Potential Single Indexes
  Utilized Composite Indexes
  Potential Composite Indexes
*/

const oneSpace = ' ';
const twoSpaces = oneSpace.repeat(2);
const fourSpaces = oneSpace.repeat(4);

const parseIndexMetrics = (indexMetricsStr: string): IndexMetrics => {
    const lines = indexMetricsStr.split('\n');
    let title: string = '';
    const sections: IndexMetricsSection[] = [];

    let currentSection: IndexMetricsSection | undefined = undefined;
    let currentIndex: { [key: string]: string } | undefined = undefined;

    for (const line of lines) {
        if (line.length === 0) {
            continue;
        }
        if (line[0] !== oneSpace) {
            title = line;
            continue;
        }

        if (line.startsWith(twoSpaces) && line[twoSpaces.length] !== oneSpace) {
            currentSection = {
                title: line.trim(),
                indexes: [],
            };
            currentIndex = undefined;

            sections.push(currentSection);
            continue;
        }

        if (line.startsWith(fourSpaces) && line[fourSpaces.length] !== oneSpace && currentSection) {
            if (line === `${fourSpaces}---`) {
                currentIndex = undefined;
                continue;
            }

            if (!currentIndex) {
                currentIndex = {};
                currentSection.indexes.push(currentIndex);
            }

            const [key, value] = line.split(':');
            if (value !== undefined) {
                currentIndex[key.trim()] = value.trim();
            }
            continue;
        }
    }

    return {
        title,
        sections,
    };
};

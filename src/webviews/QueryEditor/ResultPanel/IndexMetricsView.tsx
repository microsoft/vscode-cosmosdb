/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Label, Link, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components';
import type React from 'react';

interface IIndexMetricsSection {
    title: string;
    indexes: { [key: string]: string }[];
}

interface IIndexMetrics {
    title: string;
    sections: IIndexMetricsSection[];
}

const INDEX_METRICS_DOC_URL = "https://learn.microsoft.com/azure/cosmos-db/nosql/index-metrics?tabs=dotnet";

export const IndexMetricsView: React.FC<{ indexMetricsStr: string, topLabelStyle?: string }> = ({ indexMetricsStr, topLabelStyle }) => {
    // TODO Uncomment this example for testing
    //indexMetricsStr = "Index Utilization Information\n  Utilized Single Indexes\n    Index Spec: /name/?\n    Index Impact Score: High\n    ---\n    Index Spec: /age/?\n    Index Impact Score: High\n    ---\n    Index Spec: /town/?\n    Index Impact Score: High\n    ---\n    Index Spec: /timestamp/?\n    Index Impact Score: High\n    ---\n  Potential Single Indexes\n  Utilized Composite Indexes\n  Potential Composite Indexes\n    Index Spec: /name ASC, /town ASC, /age ASC\n    Index Impact Score: High\n    ---\n    Index Spec: /name ASC, /town ASC, /timestamp ASC\n    Index Impact Score: High\n    ---"
    const parsed = parseIndexMetrics(indexMetricsStr);
    const columns = ["Index Spec", "Index Impact Score"];

    return (<>
        <div className={topLabelStyle}>
            <Label size={'large'}>{parsed.title}</Label>
        </div>
        <Link href={INDEX_METRICS_DOC_URL}>Learn More</Link>
        <Table arial-label="Index metrics table" style={{ minWidth: '510px' }}>
            <TableHeader>
                <TableRow>
                    <TableHeaderCell />
                    <TableHeaderCell>
                        <Table>
                            <TableBody>
                                <TableRow>
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
                            {section.indexes && section.indexes.length > 0 ?
                                <Table>
                                    <TableBody>
                                        {section.indexes.map((cosmosdbIndex, index) => (
                                            <TableRow key={index}>
                                                {columns.map((column) => (
                                                    <TableCell>{cosmosdbIndex[column]}</TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table> : "-"
                            }
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </>);
};


/*
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

const parseIndexMetrics = (indexMetricsStr: string): IIndexMetrics => {
    const lines = indexMetricsStr.split('\n');
    let title: string = '';
    const sections: IIndexMetricsSection[] = [];

    let currentSection: IIndexMetricsSection | undefined = undefined;
    let currentIndex: { [key: string]: string } | undefined = undefined;

    for (const line of lines) {
        if (line.length === 0) {
            continue;
        }
        if (line[0] !== ' ') {
            title = line;
            continue;
        }

        if (line.startsWith('  ') && line[2] !== ' ') {
            currentSection = {
                title: line.trim(),
                indexes: []
            }
            currentIndex = undefined;

            sections.push(currentSection);
            continue;
        }

        if (line.startsWith('    ') && line[4] !== ' ' && currentSection) {
            if (line === '    ---') {
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
        sections
    };
}

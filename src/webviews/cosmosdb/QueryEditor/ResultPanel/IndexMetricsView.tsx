/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONValue } from '@azure/cosmos';
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
import { isJSON } from 'es-toolkit';
import type React from 'react';

interface IndexMetricsSection {
    title: string;
    indexes: { [key: string]: string }[];
}

interface IndexMetrics {
    title: string;
    sections: IndexMetricsSection[];
}

type IndexV2 = {
    IndexSpec?: string; // For single indexes
    IndexSpecs?: string[]; // For composite indexes
    IndexImpactScore?: string; // Optional impact score
};

type IndexMetricsV2 = {
    UtilizedIndexes?: {
        SingleIndexes?: IndexV2[];
        CompositeIndexes?: IndexV2[];
    };
    PotentialIndexes?: {
        SingleIndexes?: IndexV2[];
        CompositeIndexes?: IndexV2[];
    };
};

const isIndexV2 = (value: JSONValue): value is IndexV2 => {
    return !!(
        value &&
        typeof value === 'object' &&
        ('IndexSpec' in value || 'IndexSpecs' in value) &&
        ('IndexImpactScore' in value || value.IndexImpactScore === undefined) &&
        (value.IndexSpec === undefined || typeof value.IndexSpec === 'string') &&
        (value.IndexSpecs === undefined ||
            (Array.isArray(value.IndexSpecs) && value.IndexSpecs.every((spec) => typeof spec === 'string')))
    );
};

const isIndexMetricsV2 = (value: JSONValue): value is IndexMetricsV2 => {
    return !!(
        value &&
        typeof value === 'object' &&
        ('UtilizedIndexes' in value || 'PotentialIndexes' in value) &&
        (value.UtilizedIndexes === undefined ||
            (value.UtilizedIndexes &&
                typeof value.UtilizedIndexes === 'object' &&
                (value.UtilizedIndexes['SingleIndexes'] === undefined ||
                    Array.isArray(value.UtilizedIndexes['SingleIndexes'])) &&
                (value.UtilizedIndexes['CompositeIndexes'] === undefined ||
                    Array.isArray(value.UtilizedIndexes['CompositeIndexes'])))) &&
        (value.PotentialIndexes === undefined ||
            (value.PotentialIndexes &&
                typeof value.PotentialIndexes === 'object' &&
                (value.PotentialIndexes['SingleIndexes'] === undefined ||
                    Array.isArray(value.PotentialIndexes['SingleIndexes'])) &&
                (value.PotentialIndexes['CompositeIndexes'] === undefined ||
                    Array.isArray(value.PotentialIndexes['CompositeIndexes']))))
    );
};

const INDEX_METRICS_DOC_URL = 'https://learn.microsoft.com/azure/cosmos-db/nosql/index-metrics';

export const IndexMetricsView: React.FC<{ indexMetricsStr: string; topLabelStyle?: string }> = ({
    indexMetricsStr,
    topLabelStyle,
}) => {
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
                    {parsed.sections.map((section, index) => (
                        <TableRow key={`${section.title}-${index}`}>
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
 * Parse the indexMetricsStr and display the following information in a table format
 */
const parseIndexMetrics = (indexMetricsStr: string): IndexMetrics => {
    if (isJSON(indexMetricsStr)) {
        return parseIndexMetricsV2(indexMetricsStr);
    } else {
        return parseIndexMetricsV1(indexMetricsStr);
    }
};

const parseIndexMetricsV2 = (indexMetricsStr: string): IndexMetrics => {
    const title = 'Index Utilization Information';
    const sections: IndexMetricsSection[] = [];
    const json = JSON.parse(indexMetricsStr) as IndexMetricsV2;

    if (!isIndexMetricsV2(json)) {
        throw new Error('Invalid index metrics JSON format');
    }

    // Map section and subsection names
    const sectionMap: Record<string, string> = {
        UtilizedIndexes: 'Utilized',
        PotentialIndexes: 'Potential',
    };

    const subSectionMap: Record<string, string> = {
        SingleIndexes: 'Single Indexes',
        CompositeIndexes: 'Composite Indexes',
    };

    // Process UtilizedIndexes and PotentialIndexes
    for (const sectionKey in json) {
        const sectionData = json[sectionKey as keyof IndexMetricsV2];
        if (sectionData && typeof sectionData === 'object') {
            const sectionPrefix = sectionMap[sectionKey] || sectionKey;

            // Process SingleIndexes and CompositeIndexes
            for (const subSectionKey in sectionData) {
                const indexes = sectionData[subSectionKey as 'SingleIndexes' | 'CompositeIndexes'];
                if (indexes && Array.isArray(indexes)) {
                    const subSectionName = subSectionMap[subSectionKey] || subSectionKey;
                    const sectionTitle = `${sectionPrefix} ${subSectionName}`;

                    // Format indexes for display
                    const formattedIndexes = indexes.map((index) => {
                        if (!isIndexV2(index)) {
                            throw new Error('Invalid index format in index metrics JSON');
                        }
                        // Check if the index is composite or single
                        if (index.IndexSpecs) {
                            // Handle composite indexes
                            return {
                                'Index Spec': index.IndexSpecs.join(', '),
                                'Index Impact Score': index.IndexImpactScore || '',
                            };
                        } else {
                            // Handle single indexes
                            return {
                                'Index Spec': index.IndexSpec || '',
                                'Index Impact Score': index.IndexImpactScore || '',
                            };
                        }
                    });

                    sections.push({
                        title: sectionTitle,
                        indexes: formattedIndexes,
                    });
                }
            }
        }
    }

    return { title, sections };
};

const oneSpace = ' ';
const twoSpaces = oneSpace.repeat(2);
const fourSpaces = oneSpace.repeat(4);

const parseIndexMetricsV1 = (indexMetricsStr: string): IndexMetrics => {
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
        }
    }

    return {
        title,
        sections,
    };
};

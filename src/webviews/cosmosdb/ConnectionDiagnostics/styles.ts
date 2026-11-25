/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';

export const useDiagnosticsStyles = makeStyles({
    // Diagnostics is a single screen, so omit the shared layout's navigation row.
    body: { '& > div': { gridTemplateAreas: '"header" "main"' } },
    row: {
        minWidth: 0,
        '& > div': { flexGrow: 1, alignItems: 'stretch' },
    },
    rowHeading: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
        overflowWrap: 'anywhere',
        fontVariantNumeric: 'tabular-nums',
    },
    duration: {
        color: tokens.colorNeutralForeground2,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        paddingInline: tokens.spacingHorizontalXS,
        fontSize: tokens.fontSizeBase100,
        lineHeight: tokens.lineHeightBase100,
        whiteSpace: 'nowrap',
    },
    details: {
        '&:not([hidden])': { display: 'grid' },
        marginBlockStart: tokens.spacingVerticalS,
        gap: tokens.spacingVerticalXS,
        overflowWrap: 'anywhere',
    },
    summary: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
    summaryTitle: {
        margin: 0,
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
});

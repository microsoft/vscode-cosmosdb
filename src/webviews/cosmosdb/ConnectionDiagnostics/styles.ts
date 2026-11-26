/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';

export const useDiagnosticsStyles = makeStyles({
    // Diagnostics is a single screen, so omit the shared layout's navigation row.
    body: { '& > div': { gridTemplateAreas: '"header" "main"' } },
    checks: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        margin: 0,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    row: {
        display: 'grid',
        gridTemplateColumns: '18px minmax(0, 1fr)',
        gridTemplateAreas: '"icon heading" ". details"',
        columnGap: '10px',
        rowGap: '1px',
    },
    icon: {
        gridArea: 'icon',
        height: tokens.lineHeightBase300,
        display: 'grid',
        placeItems: 'center',
        fontSize: '18px',
    },
    passed: { color: tokens.colorPaletteGreenForeground1 },
    failed: { color: tokens.colorPaletteRedForeground1 },
    info: { color: tokens.colorStatusWarningForeground1 },
    pending: { color: tokens.colorNeutralForeground4 },
    rowHeading: {
        gridArea: 'heading',
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
        gridArea: 'details',
        display: 'grid',
        gap: tokens.spacingVerticalXS,
        overflowWrap: 'anywhere',
        minHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        '& button': { fontSize: 'inherit', lineHeight: 'inherit' },
    },
    actions: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
        marginBlockStart: tokens.spacingVerticalXS,
    },
    actionError: { color: tokens.colorStatusDangerForeground1 },
    summary: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
    summaryTitle: {
        margin: 0,
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
});

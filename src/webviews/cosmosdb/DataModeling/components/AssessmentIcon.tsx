/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type CandidateAssessment } from '../../../api/types';

const useStyles = makeStyles({
    icon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        flexShrink: 0,
        borderRadius: tokens.borderRadiusCircular,
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightBold,
    },
    pass: {
        backgroundColor: tokens.colorPaletteGreenBackground1,
        color: tokens.colorPaletteGreenForeground1,
    },
    fail: {
        backgroundColor: tokens.colorPaletteRedBackground1,
        color: tokens.colorPaletteRedForeground1,
    },
    warn: {
        backgroundColor: tokens.colorPaletteYellowBackground1,
        color: tokens.colorPaletteYellowForeground2,
    },
});

const GLYPH: Record<CandidateAssessment['status'], string> = { pass: '✓', fail: '✗', info: '!', warn: '!' };

/**
 * Circular status badge shared by the Data Modeling pages: green check (pass), yellow exclamation (warning, including
 * legacy "info"), or red cross (fail). Announced as its status unless `decorative` is set.
 */
export function AssessmentIcon({
    status,
    decorative = false,
}: {
    status: CandidateAssessment['status'];
    decorative?: boolean;
}) {
    const styles = useStyles();
    const tone = status === 'pass' ? styles.pass : status === 'fail' ? styles.fail : styles.warn;
    const className = mergeClasses(styles.icon, tone);

    if (decorative) {
        return (
            <span className={className} aria-hidden="true">
                {GLYPH[status]}
            </span>
        );
    }

    const label = status === 'pass' ? l10n.t('Pass') : status === 'fail' ? l10n.t('Fail') : l10n.t('Warning');
    return (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Text glyph, not an image file.
        <span className={className} role="img" aria-label={label}>
            <span aria-hidden="true">{GLYPH[status]}</span>
        </span>
    );
}

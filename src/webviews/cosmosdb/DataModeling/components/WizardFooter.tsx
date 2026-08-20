/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ReactNode } from 'react';

/**
 * Sticky wizard footer with a status slot on the left and navigation on the
 * right. The actual wizard mechanism (Back/Next) is delegated to callbacks so
 * this can later be driven by a generic wizard package.
 */

const useStyles = makeStyles({
    root: {
        position: 'sticky',
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
        marginTop: tokens.spacingVerticalL,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        flexWrap: 'wrap',
    },
    status: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        color: tokens.colorNeutralForeground3,
    },
    actions: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        marginLeft: 'auto',
    },
});

export interface WizardFooterProps {
    status?: ReactNode;
    showBack: boolean;
    onBack: () => void;
    nextLabel: string;
    nextDisabled: boolean;
    onNext: () => void;
}

export function WizardFooter({ status, showBack, onBack, nextLabel, nextDisabled, onNext }: WizardFooterProps) {
    const styles = useStyles();
    return (
        <footer className={styles.root}>
            <div className={styles.status}>{status}</div>
            <div className={styles.actions}>
                {showBack ? (
                    <Button appearance="secondary" onClick={onBack}>
                        {l10n.t('← Back')}
                    </Button>
                ) : null}
                <Button appearance="primary" disabled={nextDisabled} onClick={onNext}>
                    {nextLabel}
                </Button>
            </div>
        </footer>
    );
}

export function ScoreStatus({ score }: { score: string }) {
    return (
        <>
            <Text>{l10n.t('Score:')}</Text>
            <Text weight="semibold">{score}</Text>
        </>
    );
}

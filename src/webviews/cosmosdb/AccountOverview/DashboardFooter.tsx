/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Text, tokens } from '@fluentui/react-components';
import { AddRegular, DeleteRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';

/**
 * Bottom action bar of the Account Overview dashboard. Left group holds the
 * account-scoped actions (create database / container, delete account); the
 * right group promotes the Data Modeler wizard. Every action triggers a host
 * command, so the controls are buttons (styled as links) with the visible label
 * as their accessible name, and the icons are hidden from assistive technology.
 */

const DATA_MODELER_HINT_ID = 'account-overview-data-modeler-hint';

const useStyles = makeStyles({
    footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
    },
    actions: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
    },
    modeler: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    link: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    icon: {
        fontSize: '16px',
    },
    hint: {
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
    },
});

export interface DashboardFooterProps {
    onAddDatabase: () => void;
    onAddContainer: () => void;
    onDeleteAccount: () => void;
    onOpenDataModeler: () => void;
}

export const DashboardFooter = ({
    onAddDatabase,
    onAddContainer,
    onDeleteAccount,
    onOpenDataModeler,
}: DashboardFooterProps) => {
    const styles = useStyles();

    return (
        <footer className={styles.footer}>
            <div className={styles.actions}>
                <Link as="button" className={styles.link} onClick={onAddDatabase}>
                    <AddRegular aria-hidden className={styles.icon} />
                    {l10n.t('Add database')}
                </Link>
                <Link as="button" className={styles.link} onClick={onAddContainer}>
                    <AddRegular aria-hidden className={styles.icon} />
                    {l10n.t('Add container')}
                </Link>
                <Link as="button" className={styles.link} onClick={onDeleteAccount}>
                    <DeleteRegular aria-hidden className={styles.icon} />
                    {l10n.t('Delete account')}
                </Link>
            </div>

            <div className={styles.modeler}>
                <Text id={DATA_MODELER_HINT_ID} className={styles.hint}>
                    {l10n.t('Design containers, partition keys, and relationships visually.')}
                </Text>
                <Link
                    as="button"
                    className={styles.link}
                    aria-describedby={DATA_MODELER_HINT_ID}
                    onClick={onOpenDataModeler}
                >
                    {l10n.t('Try Data Modeler')}
                </Link>
            </div>
        </footer>
    );
};

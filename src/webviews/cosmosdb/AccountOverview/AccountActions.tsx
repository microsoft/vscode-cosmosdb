/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, tokens, Tooltip } from '@fluentui/react-components';
import { Add16Regular, Delete16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type AccountActionInput } from '../../api/types';

const useStyles = makeStyles({
    root: {
        borderBottom: '1px solid var(--vscode-panel-border)',
        paddingBottom: tokens.spacingVerticalM,
    },
    row: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
    link: { color: 'var(--vscode-textLink-foreground)' },
    modeler: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: tokens.spacingHorizontalS,
        marginLeft: 'auto',
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
    },
    status: {
        display: 'block',
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
    },
});

export type AccountActionFailure = 'action' | 'refresh';

export function AccountActions({
    busy,
    supported,
    databaseId,
    failure,
    onAction,
}: {
    busy: boolean;
    supported: boolean;
    databaseId?: string;
    failure?: AccountActionFailure;
    onAction: (input: AccountActionInput) => void;
}) {
    const styles = useStyles();
    const containerDescription = databaseId
        ? l10n.t('Create a container in database {database}.', { database: databaseId })
        : l10n.t('Select a database in the header to add a container.');
    const modelerUnavailable = l10n.t('Data Modeler is not implemented yet.');

    return (
        <section className={styles.root} aria-label={l10n.t('Account actions')}>
            <div className={styles.row}>
                <Button
                    appearance="subtle"
                    size="small"
                    className={styles.link}
                    icon={<Add16Regular aria-hidden />}
                    disabled={busy || !supported}
                    onClick={() => onAction({ action: 'createDatabase' })}
                >
                    {l10n.t('Add database')}
                </Button>
                <Tooltip content={containerDescription} relationship="description">
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.link}
                        icon={<Add16Regular aria-hidden />}
                        disabledFocusable={busy || !supported || !databaseId}
                        onClick={() => {
                            if (databaseId) {
                                onAction({ action: 'createContainer', databaseId });
                            }
                        }}
                    >
                        {l10n.t('Add container')}
                    </Button>
                </Tooltip>
                <Button
                    appearance="subtle"
                    size="small"
                    className={styles.link}
                    icon={<Delete16Regular aria-hidden />}
                    disabled={busy}
                    onClick={() => onAction({ action: 'deleteAccount' })}
                >
                    {l10n.t('Delete account')}
                </Button>
                <div className={styles.modeler}>
                    <span>{l10n.t('Design containers, partition keys, and relationships visually.')}</span>
                    <Tooltip content={modelerUnavailable} relationship="description">
                        <Button appearance="subtle" size="small" className={styles.link} disabledFocusable>
                            {l10n.t('Try Data Modeler')}
                        </Button>
                    </Tooltip>
                </div>
            </div>
            <output className={styles.status} aria-live="polite">
                {busy ? l10n.t('Account action in progress…') : ''}
            </output>
            {failure && (
                <p role="alert">
                    {failure === 'refresh'
                        ? l10n.t('Account data could not be refreshed. Try Refresh again.')
                        : l10n.t('The account action could not be completed. Retry or use the Azure Resources view.')}
                </p>
            )}
        </section>
    );
}

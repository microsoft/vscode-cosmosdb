/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { Add16Regular, Delete16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';

const useStyles = makeStyles({
    root: { borderBottom: '1px solid var(--vscode-panel-border)', paddingBottom: '12px' },
    row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
    link: { color: 'var(--vscode-textLink-foreground)' },
});

export function OverviewActions({ overview }: { overview: AccountOverviewState }) {
    const styles = useStyles();
    const { accountActionBusy: busy, accountActionFailed: failed, runAccountAction: run } = overview;
    const databaseId = overview.selectedContainer?.databaseId;
    const supported = overview.inventory?.supported === true;

    return (
        <section className={styles.root} aria-label={l10n.t('Account actions')}>
            <div className={styles.row}>
                <Button
                    appearance="subtle"
                    size="small"
                    className={styles.link}
                    icon={<Add16Regular aria-hidden />}
                    disabled={busy || !supported}
                    onClick={() => void run({ action: 'createDatabase' })}
                >
                    {l10n.t('Add database')}
                </Button>
                <Button
                    appearance="subtle"
                    size="small"
                    className={styles.link}
                    icon={<Add16Regular aria-hidden />}
                    disabled={busy || !supported || !databaseId}
                    aria-description={
                        databaseId
                            ? l10n.t('Create a container in database {database}.', { database: databaseId })
                            : l10n.t('Select a database using Metric scope to add a container.')
                    }
                    onClick={() => {
                        if (databaseId) {
                            void run({ action: 'createContainer', databaseId });
                        }
                    }}
                >
                    {l10n.t('Add container')}
                </Button>
                <Button
                    appearance="subtle"
                    size="small"
                    className={styles.link}
                    icon={<Delete16Regular aria-hidden />}
                    disabled={busy}
                    onClick={() => void run({ action: 'deleteAccount' })}
                >
                    {l10n.t('Delete account')}
                </Button>
            </div>
            {busy && <output>{l10n.t('Account action in progress. Complete any prompts in VS Code.')}</output>}
            {failed && (
                <p role="alert">
                    {l10n.t('The account action could not be completed. Retry or use the Azure Resources view.')}
                </p>
            )}
        </section>
    );
}

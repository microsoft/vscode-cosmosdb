/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    tokens,
    typographyStyles,
} from '@fluentui/react-components';
import { Add16Regular, Delete16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type AccountActionInput } from '../../api/types';
import { ThemedTooltip as Tooltip } from '../../common/ThemedTooltip';

const useStyles = makeStyles({
    root: {
        borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        paddingBottom: tokens.spacingVerticalM,
    },
    row: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
    modeler: {
        ...typographyStyles.caption1,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: tokens.spacingHorizontalS,
        marginLeft: 'auto',
        color: tokens.colorNeutralForeground2,
    },
    failure: {
        marginTop: tokens.spacingVerticalM,
    },
});

export type AccountActionFailure = 'action' | 'refresh';

export function AccountActions({
    busy,
    supported,
    isAIFeaturesEnabled,
    isDataModelerEnabled,
    databaseId,
    failure,
    onAction,
}: {
    busy: boolean;
    supported: boolean;
    isAIFeaturesEnabled: boolean;
    isDataModelerEnabled: boolean;
    databaseId?: string;
    failure?: AccountActionFailure;
    onAction: (input: AccountActionInput) => void;
}) {
    const styles = useStyles();
    const containerDescription = databaseId
        ? l10n.t('Create a container in database {database}.', { database: databaseId })
        : l10n.t('Choose a database in this account, then create a container.');

    return (
        <section className={styles.root} aria-label={l10n.t('Account actions')}>
            <div className={styles.row}>
                <Button
                    appearance="secondary"
                    size="small"
                    icon={<Add16Regular aria-hidden />}
                    disabled={busy || !supported}
                    onClick={() => onAction({ action: 'createDatabase' })}
                >
                    {l10n.t('Add database')}
                </Button>
                <Tooltip content={containerDescription} relationship="description">
                    <Button
                        appearance="secondary"
                        size="small"
                        icon={<Add16Regular aria-hidden />}
                        disabledFocusable={busy || !supported}
                        onClick={() => onAction({ action: 'createContainer', databaseId })}
                    >
                        {l10n.t('Add container')}
                    </Button>
                </Tooltip>
                <Button
                    appearance="secondary"
                    size="small"
                    icon={<Delete16Regular aria-hidden />}
                    disabled={busy}
                    onClick={() => onAction({ action: 'deleteAccount' })}
                >
                    {l10n.t('Delete account')}
                </Button>
                {isAIFeaturesEnabled && isDataModelerEnabled && (
                    <div className={styles.modeler}>
                        <span>{l10n.t('Design containers, partition keys, and relationships visually.')}</span>
                        <Button
                            appearance="secondary"
                            size="small"
                            disabled={busy || !supported}
                            onClick={() => onAction({ action: 'openDataModeler' })}
                        >
                            {l10n.t('Try Data Modeler')}
                        </Button>
                    </div>
                )}
            </div>
            {failure && (
                <MessageBar key={failure} intent="error" className={styles.failure}>
                    <MessageBarBody>
                        <MessageBarTitle>{l10n.t('Error')}</MessageBarTitle>{' '}
                        {failure === 'refresh'
                            ? l10n.t('Account data could not be refreshed. Try Refresh again.')
                            : l10n.t(
                                  'The account action could not be completed. Retry or use the Azure Resources view.',
                              )}
                    </MessageBarBody>
                </MessageBar>
            )}
        </section>
    );
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, MessageBar, MessageBarBody, MessageBarTitle, tokens } from '@fluentui/react-components';
import { Add16Regular, Braces16Regular, Delete16Regular, Money16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef } from 'react';
import { type AccountActionInput } from '../../api/types';
import { ThemedTooltip as Tooltip } from '../../common/ThemedTooltip';
import { DataModelerCallout, DataModelerCompactEntry } from './DataModelerCallout';

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
    isDataModelerPromoCollapsed,
    databaseId,
    failure,
    onAction,
    onDataModelerPromoCollapsedChange,
}: {
    busy: boolean;
    supported: boolean;
    isAIFeaturesEnabled: boolean;
    isDataModelerEnabled: boolean;
    isDataModelerPromoCollapsed: boolean;
    databaseId?: string;
    failure?: AccountActionFailure;
    onAction: (input: AccountActionInput) => void;
    onDataModelerPromoCollapsedChange: (collapsed: boolean) => void;
}) {
    const styles = useStyles();
    const expandModelerRef = useRef<HTMLButtonElement>(null);
    const collapseModelerRef = useRef<HTMLButtonElement>(null);
    // Set by the collapse/expand controls, which unmount on click; consumed once the opposite control renders.
    const pendingModelerFocus = useRef<'expand' | 'collapse'>(undefined);
    const containerDescription = databaseId
        ? l10n.t('Create a container in database {database}.', { database: databaseId })
        : l10n.t('Choose a database in this account, then create a container.');
    const showModeler = isAIFeaturesEnabled && isDataModelerEnabled;
    const modelerDisabled = busy || !supported;
    const openModeler = () => onAction({ action: 'openDataModeler' });
    const setPromoCollapsed = (collapsed: boolean) => {
        pendingModelerFocus.current = collapsed ? 'expand' : 'collapse';
        onDataModelerPromoCollapsedChange(collapsed);
    };

    useEffect(() => {
        const target = pendingModelerFocus.current === 'expand' ? expandModelerRef : collapseModelerRef;
        if (pendingModelerFocus.current && target.current) {
            pendingModelerFocus.current = undefined;
            target.current.focus();
        }
    });

    return (
        <section className={styles.root} aria-label={l10n.t('Account actions')}>
            {showModeler && !isDataModelerPromoCollapsed && (
                <DataModelerCallout
                    disabled={modelerDisabled}
                    collapseRef={collapseModelerRef}
                    onStart={openModeler}
                    onCollapse={() => setPromoCollapsed(true)}
                />
            )}
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
                    icon={<Money16Regular aria-hidden />}
                    disabled={busy}
                    onClick={() => onAction({ action: 'openCosts' })}
                >
                    {l10n.t('View Cost')}
                </Button>
                <Button
                    appearance="secondary"
                    size="small"
                    icon={<Braces16Regular aria-hidden />}
                    disabled={busy}
                    onClick={() => onAction({ action: 'openJson' })}
                >
                    {l10n.t('View JSON')}
                </Button>
                <Button
                    appearance="secondary"
                    size="small"
                    icon={<Delete16Regular aria-hidden />}
                    disabled={busy}
                    onClick={() => onAction({ action: 'deleteAccount' })}
                >
                    {l10n.t('Delete account')}
                </Button>
                {showModeler && isDataModelerPromoCollapsed && (
                    <DataModelerCompactEntry
                        disabled={modelerDisabled}
                        expandRef={expandModelerRef}
                        onStart={openModeler}
                        onExpand={() => setPromoCollapsed(false)}
                    />
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

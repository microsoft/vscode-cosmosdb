/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, tokens, useAnnounce } from '@fluentui/react-components';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useEffect, useState } from 'react';
import { type DiagnosticsState } from '../../../connectionDiagnostics/model';
import { checkText, phaseLabel, statusLabel, stepLabel } from '../../../connectionDiagnostics/presentation';
import { type ConnectionDiagnosticsRouter } from '../../../panels/ConnectionDiagnosticsTab';

const useStyles = makeStyles({
    root: { maxWidth: '72ch', padding: tokens.spacingHorizontalXXL },
    actionGroup: { border: 0, padding: 0, margin: 0 },
    actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
    row: { marginBlockEnd: tokens.spacingVerticalM },
});

export function ConnectionDiagnostics() {
    const styles = useStyles();
    const client = useTrpcClient<ConnectionDiagnosticsRouter>();
    const { announce } = useAnnounce();
    const [state, setState] = useState<DiagnosticsState>();
    const [revision, setRevision] = useState(0);
    const [failure, setFailure] = useState(false);
    const [pending, setPending] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        async function readState() {
            try {
                const result = await client.state.query();
                if (stopped) return;
                setState(result);
                if (result.phase === 'running') timer = setTimeout(() => void readState(), 250);
                else setCancelling(false);
            } catch {
                if (!stopped) setFailure(true);
            }
        }
        void readState();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [client, revision]);

    const running = state?.phase === 'running';
    const status = failure
        ? l10n.t('Could not update connection diagnostics.')
        : state?.active
          ? l10n.t('Checking: {0}', stepLabel(state.active))
          : state
            ? phaseLabel(state)
            : l10n.t('Loading…');

    useEffect(() => {
        announce(status, { polite: true });
    }, [announce, status]);

    async function act(action: 'rerun' | 'cancel' | 'copy') {
        setPending(true);
        setFailure(false);
        try {
            if (action === 'rerun') {
                setState(await client.rerun.mutate());
                setRevision((value) => value + 1);
            } else if (action === 'cancel') {
                setCancelling(true);
                await client.cancel.mutate();
            } else {
                await client.copy.mutate();
                announce(l10n.t('Diagnostics report copied.'), { polite: true });
            }
        } catch {
            setFailure(true);
            setCancelling(false);
        } finally {
            setPending(false);
        }
    }

    return (
        <main className={styles.root}>
            <h1>{l10n.t('Cosmos DB connection diagnostics')}</h1>
            <p>{status}</p>
            <fieldset className={styles.actionGroup} aria-label={l10n.t('Diagnostics actions')}>
                <div className={styles.actions}>
                    <Button disabledFocusable={pending || (!!running && !failure)} onClick={() => void act('rerun')}>
                        {l10n.t('Run again')}
                    </Button>
                    <Button disabledFocusable={!running || pending || cancelling} onClick={() => void act('cancel')}>
                        {l10n.t('Cancel')}
                    </Button>
                    <Button disabledFocusable={!state || !!running || pending} onClick={() => void act('copy')}>
                        {l10n.t('Copy redacted report')}
                    </Button>
                </div>
            </fieldset>
            <ol>
                {state?.checks.map((check) => (
                    <li key={check.step} className={styles.row}>
                        <strong>{`${stepLabel(check.step)} — ${statusLabel(check.status)}`}</strong>
                        <div>{checkText(check, state.kind)}</div>
                        {check.observedClientIp && (
                            <div>{l10n.t('Outgoing IP reported by Cosmos DB: {0}', check.observedClientIp)}</div>
                        )}
                    </li>
                ))}
            </ol>
        </main>
    );
}

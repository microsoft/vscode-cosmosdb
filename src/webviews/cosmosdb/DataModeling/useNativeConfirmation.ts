/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type DataModelingAppRouter } from '../../api/types';

export function useNativeConfirmation() {
    const client = useTrpcClient<DataModelingAppRouter>();
    const mounted = useRef(true);
    const pending = useRef(false);
    const [confirming, setConfirming] = useState(false);
    const [confirmationError, setConfirmationError] = useState('');

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const confirm = useCallback(
        async (message: string, detail: string): Promise<boolean | undefined> => {
            if (pending.current || !mounted.current) return undefined;
            pending.current = true;
            setConfirming(true);
            setConfirmationError('');
            try {
                const result = await client.dataModeling.confirm.mutate({ message, detail });
                return mounted.current ? result : undefined;
            } catch {
                if (mounted.current) {
                    setConfirmationError(l10n.t('Could not open the confirmation dialog. Please try again.'));
                }
                return undefined;
            } finally {
                pending.current = false;
                if (mounted.current) setConfirming(false);
            }
        },
        [client],
    );

    return { confirm, confirming, confirmationError };
}

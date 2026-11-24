/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ModelingAdvisorSnapshotSchema,
    type ModelingAdvisorSnapshot,
} from '../../../dataModeling/modelingAdvisorSchema';
import { createInitialSnapshot } from './dataModel';

export { createInitialSnapshot } from './dataModel';

interface Persistence {
    load: () => Promise<ModelingAdvisorSnapshot | null>;
    save: (snapshot: ModelingAdvisorSnapshot) => Promise<void>;
}

export function useModelingAdvisorPersistence({ load, save }: Persistence) {
    const [snapshot, setSnapshot] = useState(createInitialSnapshot);
    const [loadStatus, setLoadStatus] = useState<'loading' | 'ready'>('loading');
    const [loadFailed, setLoadFailed] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [saveFailed, setSaveFailed] = useState(false);
    const lastSnapshot = useRef<ModelingAdvisorSnapshot>(snapshot);
    const saveSequence = useRef(0);
    const canSave = useRef(false);

    useEffect(() => {
        let disposed = false;
        canSave.current = false;
        setLoadStatus('loading');
        const hydrate = async () => {
            try {
                const saved = await load();
                const loaded = saved === null ? createInitialSnapshot() : ModelingAdvisorSnapshotSchema.parse(saved);
                if (!disposed) {
                    lastSnapshot.current = loaded;
                    setSnapshot(loaded);
                    canSave.current = true;
                    setLoadFailed(false);
                    setSaveFailed(false);
                }
            } catch {
                if (!disposed) setLoadFailed(true);
            } finally {
                if (!disposed) setLoadStatus('ready');
            }
        };
        void hydrate();
        return () => {
            disposed = true;
            canSave.current = false;
        };
    }, [load, loadAttempt]);

    const persist = useCallback(
        (next: ModelingAdvisorSnapshot) => {
            if (!canSave.current) {
                return Promise.reject(new Error(l10n.t('Retry loading the saved data model before saving changes.')));
            }
            const sequence = ++saveSequence.current;
            return save(next).then(
                () => {
                    if (sequence === saveSequence.current) {
                        setSaveFailed(false);
                    }
                },
                (error: unknown) => {
                    if (sequence === saveSequence.current) {
                        setSaveFailed(true);
                    }
                    throw error;
                },
            );
        },
        [save],
    );

    useEffect(() => {
        if (loadStatus === 'ready' && !loadFailed && snapshot !== lastSnapshot.current) {
            lastSnapshot.current = snapshot;
            // persist surfaces the failure in the retry UI; the effect has no caller to reject to.
            void persist(snapshot).catch(() => undefined);
        }
    }, [loadStatus, loadFailed, snapshot, persist]);

    const flush = useCallback(
        (next: ModelingAdvisorSnapshot) => {
            lastSnapshot.current = next;
            return persist(next);
        },
        [persist],
    );

    return {
        snapshot,
        setSnapshot,
        loadStatus,
        loadFailed,
        saveFailed,
        flush,
        retryLoad: () => {
            canSave.current = false;
            setLoadAttempt((attempt) => attempt + 1);
        },
        retrySave: () => {
            void persist(snapshot).catch(() => undefined);
        },
    };
}

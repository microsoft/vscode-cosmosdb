/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ModelingAdvisorSnapshot } from '../../../dataModeling/modelingAdvisorSchema';
import { createInitialState } from './dataModel';

export function createInitialSnapshot(): ModelingAdvisorSnapshot {
    return { wizard: createInitialState(), recommendation: { status: 'idle' } };
}

interface Persistence {
    load: () => Promise<ModelingAdvisorSnapshot | null>;
    save: (snapshot: ModelingAdvisorSnapshot) => Promise<void>;
}

export function useModelingAdvisorPersistence({ load, save }: Persistence) {
    const [snapshot, setSnapshot] = useState(createInitialSnapshot);
    const [loadStatus, setLoadStatus] = useState<'loading' | 'choice' | 'ready' | 'error'>('loading');
    const [saveFailed, setSaveFailed] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const savedSnapshot = useRef<ModelingAdvisorSnapshot | null>(null);
    const lastSnapshot = useRef<ModelingAdvisorSnapshot>(snapshot);
    const saveSequence = useRef(0);

    useEffect(() => {
        let disposed = false;
        setLoadStatus('loading');
        void load().then(
            (saved) => {
                if (disposed) {
                    return;
                }
                savedSnapshot.current = saved;
                // Do not replace saved work with the default Workload page while the user is choosing.
                setLoadStatus(saved ? 'choice' : 'ready');
            },
            () => {
                if (!disposed) {
                    setLoadStatus('error');
                }
            },
        );
        return () => {
            disposed = true;
        };
    }, [load, loadAttempt]);

    const persist = useCallback(
        (next: ModelingAdvisorSnapshot) => {
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
        if (loadStatus === 'ready' && snapshot !== lastSnapshot.current) {
            lastSnapshot.current = snapshot;
            // persist surfaces the failure in the retry UI; the effect has no caller to reject to.
            void persist(snapshot).catch(() => undefined);
        }
    }, [loadStatus, snapshot, persist]);

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
        saveFailed,
        flush,
        retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
        retrySave: () => {
            void persist(snapshot).catch(() => undefined);
        },
        continueExisting: () => {
            if (savedSnapshot.current) {
                lastSnapshot.current = savedSnapshot.current;
                setSnapshot(savedSnapshot.current);
                setLoadStatus('ready');
            }
        },
        startNew: () => {
            setSnapshot(createInitialSnapshot());
            setLoadStatus('ready');
        },
    };
}

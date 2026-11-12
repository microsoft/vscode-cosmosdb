/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
    const [saveFailed, setSaveFailed] = useState(false);
    const lastSnapshot = useRef<ModelingAdvisorSnapshot>(snapshot);
    const saveSequence = useRef(0);

    useEffect(() => {
        let disposed = false;
        setLoadStatus('loading');
        const hydrate = async () => {
            let loaded: ModelingAdvisorSnapshot;
            let failed = false;
            try {
                const saved = await load();
                loaded = saved === null ? createInitialSnapshot() : ModelingAdvisorSnapshotSchema.parse(saved);
            } catch {
                loaded = createInitialSnapshot();
                failed = true;
            }
            if (!disposed) {
                lastSnapshot.current = loaded;
                setSnapshot(loaded);
                setLoadFailed(failed);
                setLoadStatus('ready');
            }
        };
        void hydrate();
        return () => {
            disposed = true;
        };
    }, [load]);

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
        loadFailed,
        saveFailed,
        flush,
        retrySave: () => {
            void persist(snapshot).catch(() => undefined);
        },
    };
}

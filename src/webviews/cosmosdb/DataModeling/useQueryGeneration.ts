/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    queryGenerationContext,
    queryGenerationFingerprint,
    type QueryGenerationOutcome,
    type QueryGenerationResult,
} from '../../../dataModeling/queryGeneration';
import { type DataModelingAppRouter } from '../../api/types';
import { type DataModel } from './dataModel';
import { queryPropertyNames, queryTextPatch } from './queryFilterProperties';

export interface QueryGenerationStatus {
    opening: boolean;
    message: string;
}

interface PendingQuery {
    requestId: string;
    containerId: string;
    readId: string;
    fingerprint: string;
}

export const queryGenerationKey = (containerId: string, readId: string): string =>
    JSON.stringify([containerId, readId]);

const staleMessage = () => l10n.t('The query or schema changed. Generate the query again to use the latest inputs.');

export function useQueryGeneration(model: DataModel, onChange: (model: DataModel) => void) {
    const client = useTrpcClient<DataModelingAppRouter>();
    const requests = useRef(new Map<string, PendingQuery>());
    const [statuses, setStatuses] = useState<Record<string, QueryGenerationStatus>>({});
    const [deliveries, setDeliveries] = useState<QueryGenerationResult[]>([]);
    const setStatus = useCallback((key: string, message: string, opening = false) => {
        setStatuses((previous) => ({ ...previous, [key]: { message, opening } }));
    }, []);
    const receive = useCallback((result: QueryGenerationResult) => {
        setDeliveries((previous) => [...previous, result]);
    }, []);
    const subscriptionFailed = useCallback(() => {
        for (const key of requests.current.keys()) {
            setStatus(key, l10n.t('Could not receive the generated query. Generate it again to retry.'));
        }
        requests.current.clear();
    }, [setStatus]);

    useEffect(() => {
        // Invalidate on edits, even if the user later restores the original text. Navigation and QPS changes are safe.
        for (const [key, request] of requests.current) {
            const container = model.containers.find((item) => item.id === request.containerId);
            const read = container?.reads.find((item) => item.id === request.readId);
            if (!container || !read || queryGenerationFingerprint(container, read) !== request.fingerprint) {
                requests.current.delete(key);
                setStatus(key, staleMessage());
            }
        }
    }, [model, setStatus]);

    useEffect(() => {
        if (!deliveries.length) return;
        let next = model;
        for (const result of deliveries) {
            const entry = [...requests.current].find(([, pending]) => pending.requestId === result.requestId);
            let outcome: QueryGenerationOutcome = 'stale';
            if (entry) {
                const [key, request] = entry;
                const container = next.containers.find((item) => item.id === request.containerId);
                const read = container?.reads.find((item) => item.id === request.readId);
                if (container && read && queryGenerationFingerprint(container, read) === request.fingerprint) {
                    if (result.error !== undefined) {
                        outcome = 'error';
                        setStatus(key, l10n.t('Could not generate query: {reason}', { reason: result.error }));
                    } else if (!result.query?.trim() || !queryPropertyNames(result.query).valid) {
                        outcome = 'invalidQuery';
                        setStatus(
                            key,
                            l10n.t('Copilot returned invalid SQL. Ask it to correct the query or generate again.'),
                        );
                    } else {
                        const patch = queryTextPatch(
                            read,
                            result.query,
                            container.properties.map((property) => property.name),
                        );
                        next = {
                            ...next,
                            containers: next.containers.map((item) =>
                                item.id !== container.id
                                    ? item
                                    : {
                                          ...item,
                                          reads: item.reads.map((row) =>
                                              row.id === read.id ? { ...row, ...patch } : row,
                                          ),
                                      },
                            ),
                        };
                        outcome = 'applied';
                        setStatus(key, l10n.t('Query generated. Review it before using it.'));
                    }
                } else {
                    setStatus(key, staleMessage());
                }
                if (outcome !== 'invalidQuery') requests.current.delete(key);
            }
            void client.dataModeling.acknowledgeQuery.mutate({ requestId: result.requestId, outcome }).catch(() => {
                if (entry) {
                    setStatus(
                        entry[0],
                        l10n.t('Could not confirm the query update to Copilot. Check the query before retrying.'),
                    );
                }
            });
        }
        if (next !== model) onChange(next);
        setDeliveries([]);
    }, [deliveries, model, onChange, client, setStatus]);

    const generate = useCallback(
        async (containerId: string, readId: string) => {
            const container = model.containers.find((item) => item.id === containerId);
            const read = container?.reads.find((item) => item.id === readId);
            const key = queryGenerationKey(containerId, readId);
            if (!container || !read?.pattern.trim()) {
                setStatus(key, l10n.t('Enter a query description before generating a query.'));
                return;
            }
            const requestId = crypto.randomUUID();
            requests.current.set(key, {
                requestId,
                containerId,
                readId,
                fingerprint: queryGenerationFingerprint(container, read),
            });
            setStatus(key, l10n.t('Opening Copilot Chat…'), true);
            try {
                await client.dataModeling.generateQuery.mutate({
                    requestId,
                    ...queryGenerationContext(container, read),
                });
                if (requests.current.get(key)?.requestId === requestId) {
                    setStatus(key, l10n.t('Waiting for Copilot. Use the sparkle button again to retry.'));
                }
            } catch (error) {
                if (requests.current.get(key)?.requestId !== requestId) return;
                requests.current.delete(key);
                setStatus(
                    key,
                    l10n.t('Could not open Copilot Chat: {reason}', {
                        reason: error instanceof Error ? error.message : l10n.t('Unknown error'),
                    }),
                );
            }
        },
        [client, model, setStatus],
    );

    return { generate, statuses, receive, subscriptionFailed };
}

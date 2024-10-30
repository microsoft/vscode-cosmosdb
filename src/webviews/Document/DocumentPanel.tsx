/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONObject, type PartitionKeyDefinition } from '@azure/cosmos';
import { makeStyles, MessageBar, ProgressBar } from '@fluentui/react-components';
import { parse as parseJson } from '@prantlf/jsonlint';
import { useEffect } from 'react';
import { extractPartitionKey } from '../../utils/document';
import { MonacoEditor } from '../MonacoEditor';
import { DocumentToolbar } from './DocumentToolbar';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

const useClasses = makeStyles({
    resultDisplay: {
        marginTop: '10px',
        width: '100%',
        height: 'calc(100% - 50px)', // Toolbar height is 40px + 10px margin
    },
    container: {
        marginTop: '10px',
        height: 'calc(100% - 10px)', // 10px margin
    },
});

const validateDocument = (content: string, partitionKey?: PartitionKeyDefinition) => {
    const errors: string[] = [];

    try {
        // Check JSON schema
        const resource = parseJson(content) as JSONObject;

        // Check partition key
        if (partitionKey) {
            const partitionKeyPaths = partitionKey.paths.map((path) => (path.startsWith('/') ? path.slice(1) : path));
            const partitionKeyValues = extractPartitionKey(resource, partitionKey);
            if (!partitionKeyValues) {
                errors.push('Partition key is incomplete.');
            }

            if (Array.isArray(partitionKeyValues)) {
                partitionKeyValues
                    .map((value, index) => {
                        if (!value) {
                            return `Partition key ${partitionKeyPaths[index]} is invalid.`;
                        }
                        return null;
                    })
                    .filter((value) => value !== null)
                    .forEach((value) => errors.push(value));
            }
        }

        // Check document id
        if (resource.id) {
            if (typeof resource.id !== 'string') {
                errors.push('Id must be a string.');
            } else {
                if (
                    resource.id.indexOf('/') !== -1 ||
                    resource.id.indexOf('\\') !== -1 ||
                    resource.id.indexOf('?') !== -1 ||
                    resource.id.indexOf('#') !== -1
                ) {
                    errors.push('Id contains illegal chars (/, \\, ?, #).');
                }
                if (resource.id[resource.id.length - 1] === ' ') {
                    errors.push('Id ends with a space.');
                }
            }
        }
    } catch (err) {
        if (err instanceof SyntaxError) {
            errors.push(err.message);
        } else if (err instanceof Error) {
            errors.push(err.message);
        } else {
            errors.push('Unknown error');
        }
    }

    return errors;
};

export const DocumentPanel = () => {
    const classes = useClasses();
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const isReadOnly = state.mode === 'view';
    const inProgress = state.isSaving || state.isRefreshing;

    const onChange = (newValue: string) => {
        dispatcher.setCurrentDocumentContent(newValue);

        const errors = validateDocument(newValue, state.partitionKey);

        dispatcher.setValid(errors.length === 0, errors);
    };

    // TODO: Hack, remove this when DocumentPanel will be moved to CustomTextEditor.
    useEffect(() => {
        void dispatcher?.notifyDirty?.(state.isDirty);
    }, [dispatcher, state.isDirty]);

    return (
        <section className={classes.container}>
            <DocumentToolbar />
            {inProgress && <ProgressBar />}
            {state.error && (
                <MessageBar key={'error'} intent={'error'} layout={'multiline'}>
                    {state.error}
                </MessageBar>
            )}
            {isReadOnly && <MessageBar intent={'info'}>This document is read-only.</MessageBar>}
            <section className={classes.resultDisplay}>
                <MonacoEditor
                    height={'100%'}
                    width={'100%'}
                    defaultLanguage={'json'}
                    value={state.currentDocumentContent ?? 'No result'}
                    options={{ domReadOnly: isReadOnly, readOnly: isReadOnly }}
                    onChange={onChange}
                />
            </section>
        </section>
    );
};

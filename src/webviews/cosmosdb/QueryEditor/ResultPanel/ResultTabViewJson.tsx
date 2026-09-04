/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    ProgressBar,
    Text,
    Tooltip,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isLargeQueryResultJson, QUERY_RESULT_JSON_PREVIEW_BYTES } from '../../../../cosmosdb/queryResultJsonPolicy';
import { type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';
import { getQueryResultJsonByteLength, getQueryResultJsonChunks } from '../../../utils';

const useClasses = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        width: '100%',
    },
    warning: {
        alignSelf: 'center',
        marginTop: '24px',
        maxWidth: '640px',
    },
    editor: {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        height: '100%',
        minHeight: 0,
        width: '100%',
    },
    editorSurface: {
        flexGrow: 1,
        minHeight: 0,
    },
    loading: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
});

const encoder = new TextEncoder();

const LARGE_JSON_EDITOR_OPTIONS: MonacoEditorType.editor.IStandaloneEditorConstructionOptions = {
    ariaLabel: l10n.t('Query results JSON'),
    bracketPairColorization: { enabled: false },
    colorDecorators: false,
    domReadOnly: true,
    folding: false,
    guides: {
        bracketPairs: false,
        indentation: false,
    },
    largeFileOptimizations: true,
    links: false,
    matchBrackets: 'never',
    minimap: { enabled: false },
    occurrencesHighlight: 'off',
    readOnly: true,
    renderWhitespace: 'none',
    selectionHighlight: false,
    stickyScroll: { enabled: false },
    wordWrap: 'off',
};

const editorRevisions = new WeakMap<SerializedQueryResult, number>();
let nextEditorRevision = 0;

const getEditorRevision = (queryResult: SerializedQueryResult): number => {
    const existingRevision = editorRevisions.get(queryResult);
    if (existingRevision !== undefined) {
        return existingRevision;
    }

    const revision = ++nextEditorRevision;
    editorRevisions.set(queryResult, revision);
    return revision;
};

type LargeResultMode = 'warning' | 'preview' | 'all';

type LargeResultState = {
    mode: LargeResultMode;
    queryResult: SerializedQueryResult;
};

type ResultJsonEditorProps = {
    focusOnMount: boolean;
    maximumBytes?: number;
    queryResult: SerializedQueryResult;
    totalByteLength: number;
};

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const ResultJsonEditor = ({
    focusOnMount,
    maximumBytes = Number.POSITIVE_INFINITY,
    queryResult,
    totalByteLength,
}: ResultJsonEditorProps) => {
    const classes = useClasses();
    const modelRef = useRef<MonacoEditorType.editor.ITextModel | null>(null);
    const loadRevisionRef = useRef(0);
    const [loadedByteLength, setLoadedByteLength] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const expectedByteLength = Math.min(maximumBytes, totalByteLength);
    const progress = expectedByteLength > 0 ? loadedByteLength / expectedByteLength : 1;
    const loadingLabel = l10n.t(
        'Loading JSON… {0}%',
        new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(progress * 100),
    );

    const handleMount = useCallback<NonNullable<React.ComponentProps<typeof MonacoEditor>['onMount']>>(
        (editor, monaco) => {
            const model = editor.getModel();
            if (!model) {
                return;
            }

            modelRef.current = model;
            model.setValue('');
            setLoadedByteLength(0);
            setIsLoading(true);

            if (focusOnMount) {
                editor.focus();
            }

            const loadRevision = ++loadRevisionRef.current;
            void (async () => {
                let loadedBytes = 0;

                for (const chunk of getQueryResultJsonChunks(queryResult, maximumBytes)) {
                    if (loadRevision !== loadRevisionRef.current || model.isDisposed() || modelRef.current !== model) {
                        return;
                    }

                    const position = model.getPositionAt(model.getValueLength());
                    model.applyEdits(
                        [
                            {
                                range: new monaco.Range(
                                    position.lineNumber,
                                    position.column,
                                    position.lineNumber,
                                    position.column,
                                ),
                                text: chunk,
                            },
                        ],
                        false,
                    );

                    loadedBytes += encoder.encode(chunk).byteLength;
                    setLoadedByteLength(loadedBytes);
                    await yieldToBrowser();
                }

                if (loadRevision === loadRevisionRef.current && !model.isDisposed()) {
                    setIsLoading(false);
                }
            })();
        },
        [focusOnMount, maximumBytes, queryResult],
    );

    useEffect(
        () => () => {
            loadRevisionRef.current++;
            if (modelRef.current && !modelRef.current.isDisposed()) {
                modelRef.current.dispose();
            }
            modelRef.current = null;
        },
        [],
    );

    return (
        <div className={classes.editor}>
            {isLoading && (
                <div className={classes.loading}>
                    <Text>{loadingLabel}</Text>
                    <ProgressBar aria-label={loadingLabel} value={progress} />
                </div>
            )}
            <div className={classes.editorSurface}>
                <MonacoEditor
                    height={'100%'}
                    width={'100%'}
                    defaultLanguage={'json'}
                    defaultValue={''}
                    options={LARGE_JSON_EDITOR_OPTIONS}
                    onMount={handleMount}
                />
            </div>
        </div>
    );
};

const formatByteLength = (byteLength: number): string => {
    const sizeInMiB = byteLength / (1024 * 1024);
    if (sizeInMiB >= 1) {
        return l10n.t('{0} MiB', new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(sizeInMiB));
    }

    const sizeInKiB = byteLength / 1024;
    return l10n.t('{0} KiB', new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(sizeInKiB));
};

type ResultTabViewJsonProps = {
    queryResult: SerializedQueryResult;
};

export const ResultTabViewJson = ({ queryResult }: ResultTabViewJsonProps) => {
    const classes = useClasses();
    const warningRef = useRef<HTMLDivElement>(null);
    const [largeResultState, setLargeResultState] = useState<LargeResultState>({
        mode: 'warning',
        queryResult,
    });
    const byteLength = useMemo(() => getQueryResultJsonByteLength(queryResult), [queryResult]);
    const isLarge = isLargeQueryResultJson(byteLength);
    const mode = isLarge && largeResultState.queryResult !== queryResult ? 'warning' : largeResultState.mode;
    const editorRevision = getEditorRevision(queryResult);

    useEffect(() => {
        if (isLarge && mode === 'warning') {
            warningRef.current?.focus();
        }
    }, [isLarge, mode, queryResult]);

    if (!isLarge) {
        return (
            <ResultJsonEditor
                key={editorRevision}
                queryResult={queryResult}
                totalByteLength={byteLength}
                focusOnMount={false}
            />
        );
    }

    if (mode === 'warning') {
        const title = l10n.t('Large JSON result');
        const showPreviewLabel = l10n.t('Show preview');
        const showPreviewDescription = l10n.t(
            'Open only the first {0} of the JSON result.',
            formatByteLength(QUERY_RESULT_JSON_PREVIEW_BYTES),
        );
        const warningMessage = l10n.t(
            'This result is approximately {0}. Opening all of it may make the editor slow or unresponsive.',
            formatByteLength(byteLength),
        );
        return (
            <MessageBar ref={warningRef} className={classes.warning} intent="warning" tabIndex={-1}>
                <MessageBarBody>
                    <MessageBarTitle>{title}</MessageBarTitle>
                    <Text>{warningMessage}</Text>
                </MessageBarBody>
                <MessageBarActions>
                    <Tooltip content={showPreviewDescription} relationship="description">
                        <Button
                            appearance="primary"
                            aria-description={showPreviewDescription}
                            onClick={() => setLargeResultState({ mode: 'preview', queryResult })}
                        >
                            {showPreviewLabel}
                        </Button>
                    </Tooltip>
                    <Button onClick={() => setLargeResultState({ mode: 'all', queryResult })}>
                        {l10n.t('Open all')}
                    </Button>
                </MessageBarActions>
            </MessageBar>
        );
    }

    return (
        <div className={classes.container}>
            {mode === 'preview' && (
                <MessageBar intent="info">
                    <MessageBarBody>
                        <MessageBarTitle>{l10n.t('Preview only')}</MessageBarTitle>
                        <Text>
                            {l10n.t(
                                'Showing the first {0}. The complete JSON result has not been opened.',
                                formatByteLength(QUERY_RESULT_JSON_PREVIEW_BYTES),
                            )}
                        </Text>
                    </MessageBarBody>
                    <MessageBarActions>
                        <Button onClick={() => setLargeResultState({ mode: 'all', queryResult })}>
                            {l10n.t('Open all')}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            )}
            <ResultJsonEditor
                key={`${editorRevision}:${mode}`}
                queryResult={queryResult}
                totalByteLength={byteLength}
                maximumBytes={mode === 'preview' ? QUERY_RESULT_JSON_PREVIEW_BYTES : undefined}
                focusOnMount={true}
            />
        </div>
    );
};

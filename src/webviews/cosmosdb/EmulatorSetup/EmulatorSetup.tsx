/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Field,
    Input,
    Link,
    Radio,
    RadioGroup,
    makeStyles,
    tokens,
    useAnnounce,
} from '@fluentui/react-components';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type EmulatorSetupRouter } from '../../../panels/EmulatorSetupTab';
import {
    containerEngines,
    defaultPorts,
    stages,
    validPorts,
    type ContainerEngine,
    type SetupProgress,
    type SetupStage,
} from '../../../services/managedEmulator/model';

const useStyles = makeStyles({
    layout: { maxWidth: '760px', margin: 'auto', padding: '24px' },
    actions: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' },
    status: { color: tokens.colorPaletteRedForeground1 },
    fields: { display: 'grid', gap: '12px', maxWidth: '420px' },
});

function stageLabel(stage: SetupStage): string {
    switch (stage) {
        case 'docker':
            return l10n.t('Check container engine');
        case 'ports':
            return l10n.t('Check local ports');
        case 'image':
            return l10n.t('Prepare emulator image');
        case 'volume':
            return l10n.t('Prepare persistent data volume');
        case 'container':
            return l10n.t('Start emulator container');
        case 'readiness':
            return l10n.t('Verify Cosmos DB connectivity');
        case 'connection':
            return l10n.t('Save the emulator connection');
    }
}

export function EmulatorSetup() {
    const css = useStyles();
    const rpc = useTrpcClient<EmulatorSetupRouter>();
    const { announce } = useAnnounce();
    const heading = useRef<HTMLHeadingElement>(null);
    const [step, setStep] = useState(0);
    const [engine, setEngine] = useState<ContainerEngine>('docker');
    const [detected, setDetected] = useState<ContainerEngine[]>();
    const [endpoint, setEndpoint] = useState(String(defaultPorts.endpoint));
    const [explorer, setExplorer] = useState(String(defaultPorts.explorer));
    const [progress, setProgress] = useState<SetupProgress>();
    const [error, setError] = useState<string>();
    const [running, setRunning] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [checking, setChecking] = useState(false);
    const stepLabels = [l10n.t('Introduction'), l10n.t('Configure'), l10n.t('Set up'), l10n.t('Done')];
    const ports = { endpoint: Number(endpoint), explorer: Number(explorer) };
    const connectionError = l10n.t('Could not contact the emulator setup service. Try again.');

    const detect = useCallback(async () => {
        setChecking(true);
        setError(undefined);
        try {
            const result = await rpc.engines.query();
            setError(result.error);
            setDetected(result.engines);
            const only = result.engines?.length === 1 ? result.engines[0] : undefined;
            if (only) setEngine(only);
        } catch {
            setError(connectionError);
        } finally {
            setChecking(false);
        }
    }, [connectionError, rpc]);

    useEffect(() => {
        heading.current?.focus();
    }, [step, waiting]);

    useEffect(() => {
        let active = true;
        void rpc.status
            .query()
            .then(({ instance, error: problem }) => {
                if (!active) return;
                if (instance?.status === 'waiting') {
                    setWaiting(true);
                    setProgress({ stage: 'readiness', state: 'waiting' });
                    setStep(2);
                } else if (instance?.status === 'running') {
                    setProgress({ stage: 'connection', state: 'done' });
                    setStep(3);
                }
                setError(problem);
            })
            .catch(() => {
                if (active) setError(connectionError);
            });
        const subscription = rpc.checkProgress.subscribe(undefined, {
            onData: (event) => {
                setProgress(event);
                if (event.state === 'active') announce(stageLabel(event.stage));
            },
            onError: () => {
                if (active) setError(connectionError);
            },
        });
        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, [announce, connectionError, rpc]);

    async function run(resume: boolean): Promise<void> {
        setError(undefined);
        setRunning(true);
        if (!resume) setProgress(undefined);
        setStep(2);
        try {
            const result = await (resume ? rpc.waitLonger.mutate() : rpc.setup.mutate({ engine, ports }));
            setError(result.error);
            setWaiting(result.waiting === true);
            if (!result.error) {
                setProgress({ stage: 'connection', state: 'done' });
                setStep(3);
            }
        } catch {
            setError(connectionError);
        } finally {
            setRunning(false);
        }
    }

    const activeStage = progress ? stages.indexOf(progress.stage) : -1;
    return (
        <main className={css.layout}>
            <nav aria-label={l10n.t('Setup steps')}>
                <ol>
                    {stepLabels.map((label, index) => (
                        <li key={label} aria-current={index === step ? 'step' : undefined}>
                            {label}
                        </li>
                    ))}
                </ol>
            </nav>
            <h1 ref={heading} tabIndex={-1}>
                {stepLabels[step]}
            </h1>
            {step === 0 && (
                <>
                    <p>
                        {l10n.t(
                            'Set up a local Azure Cosmos DB Emulator for NoSQL using Docker or Podman, without entering a key.',
                        )}
                    </p>
                    <Button
                        appearance="primary"
                        onClick={() => {
                            setStep(1);
                            void detect();
                        }}
                    >
                        {l10n.t('Continue')}
                    </Button>
                </>
            )}
            {step === 1 && (
                <>
                    <div className={css.fields}>
                        <Field label={l10n.t('Container engine')}>
                            <RadioGroup
                                value={engine}
                                onChange={(_, { value }) => setEngine(value === 'podman' ? 'podman' : 'docker')}
                            >
                                {containerEngines.map((value) => (
                                    <Radio key={value} value={value} label={value === 'docker' ? 'Docker' : 'Podman'} />
                                ))}
                            </RadioGroup>
                        </Field>
                        <Field label={l10n.t('Cosmos DB endpoint port')}>
                            <Input
                                type="number"
                                value={endpoint}
                                onChange={(_, data) => setEndpoint(data.value)}
                                min={1}
                                max={65535}
                            />
                        </Field>
                        <Field label={l10n.t('Data Explorer port')}>
                            <Input
                                type="number"
                                value={explorer}
                                onChange={(_, data) => setExplorer(data.value)}
                                min={1}
                                max={65535}
                            />
                        </Field>
                    </div>
                    {!validPorts(ports) && <p>{l10n.t('Enter two different port numbers between 1 and 65535.')}</p>}
                    {detected && !detected.includes(engine) && (
                        <>
                            <p>
                                {l10n.t(
                                    'Install the container engine on the machine running the extension. If the installer changed PATH, fully restart VS Code before checking again.',
                                )}
                            </p>
                            <div className={css.actions}>
                                <Link href="https://docs.docker.com/get-docker/" target="_blank" rel="noreferrer">
                                    {l10n.t('Install Docker')}
                                </Link>
                                <Link href="https://podman.io/docs/installation" target="_blank" rel="noreferrer">
                                    {l10n.t('Install Podman')}
                                </Link>
                            </div>
                        </>
                    )}
                    <div className={css.actions}>
                        <Button onClick={() => setStep(0)}>{l10n.t('Back')}</Button>
                        <Button disabled={checking} onClick={() => void detect()}>
                            {l10n.t('Check again')}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={checking || !validPorts(ports) || !detected?.includes(engine)}
                            onClick={() => void run(false)}
                        >
                            {l10n.t('Start setup')}
                        </Button>
                    </div>
                </>
            )}
            {step >= 2 && (
                <>
                    <h2>{l10n.t('Setup progress')}</h2>
                    <ol>
                        {stages.map((stage, index) => {
                            const status =
                                index < activeStage || progress?.state === 'done'
                                    ? l10n.t('Complete')
                                    : index === activeStage
                                      ? waiting
                                          ? l10n.t('Waiting')
                                          : error
                                            ? l10n.t('Interrupted')
                                            : l10n.t('In progress')
                                      : l10n.t('Not started');
                            return (
                                <li key={stage}>
                                    <strong>{stageLabel(stage)}</strong> {status}
                                </li>
                            );
                        })}
                    </ol>
                    <div className={css.actions}>
                        {running && (
                            <Button onClick={() => void rpc.cancel.mutate().catch(() => setError(connectionError))}>
                                {l10n.t('Cancel')}
                            </Button>
                        )}
                        {step === 2 &&
                            !running &&
                            (waiting ? (
                                <Button appearance="primary" onClick={() => void run(true)}>
                                    {l10n.t('Wait longer')}
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => {
                                        setError(undefined);
                                        setStep(1);
                                        void detect();
                                    }}
                                >
                                    {l10n.t('Back to configure')}
                                </Button>
                            ))}
                        {step === 3 && (
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    void rpc.openConnection
                                        .mutate()
                                        .then((result) => setError(result.error))
                                        .catch(() => setError(connectionError));
                                }}
                            >
                                {l10n.t('Open connection')}
                            </Button>
                        )}
                    </div>
                </>
            )}
            {error && (
                <p role="alert" className={css.status}>
                    {error}
                </p>
            )}
        </main>
    );
}

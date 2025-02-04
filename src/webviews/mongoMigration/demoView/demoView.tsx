/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, type JSX } from 'react';

import { Button, Card, CardHeader, Input, Label, ProgressBar, Select, Switch } from '@fluentui/react-components';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import './demoView.scss';
import { type DemoViewWebviewConfigurationType } from './demoViewController';

export const DemoView = (): JSX.Element => {
    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     * Feel free to update the content of the object. It won't be synced back to the extension though.
     */
    const configuration = useConfiguration<DemoViewWebviewConfigurationType>();

    /**
     * Use the `useTrpcClient` hook to get the tRPC client and an event target
     * for handling notifications from the extension.
     */
    const { trpcClient } = useTrpcClient();

    const [migrationLog, setMigrationLog] = useState<string>('');

    return (
        <div className="documentView">
            <ProgressBar thickness="large" shape="square" className="progressBar" />

            <h1>{`Migrate ${configuration.databaserName}`}</h1>

            <div className="migrationControls" style={{ display: 'flex', gap: '10px' }}>
                <Button
                    appearance="primary"
                    onClick={() => {
                        /**
                         * a simple call with no parameters, but with error handling.
                         * telemetry is "added " in the router for the function call
                         */

                        trpcClient.mongoMigration.getInfo
                            .query()
                            .then((result) => {
                                setMigrationLog(JSON.stringify(result, null, 2));
                            })
                            .catch((error) => {
                                void trpcClient.common.displayErrorMessage.mutate({
                                    message: 'Error while loading the data',
                                    modal: false,
                                    cause: error instanceof Error ? error.message : String(error),
                                });
                            });

                        /**
                         * one can still send additional telemetry information
                         */

                        trpcClient.common.reportEvent
                            .mutate({
                                eventName: 'startMigration',
                                properties: {
                                    ui: 'button', // button, not a command
                                },
                                measurements: {
                                    connectionsCount: 23,
                                },
                            })
                            .catch((error) => {
                                console.debug('Failed to report an event:', error);
                            });
                    }}
                >
                    Connect to MongoDB Cluster
                </Button>
                <Button
                    appearance="primary"
                    onClick={() => {
                        /**
                         * a simple call with no parameters, but with error handling.
                         * telemetry is "added " in the router for the function call
                         */

                        trpcClient.mongoMigration.sayMyName
                            .query('MongoDB')
                            .then((result) => {
                                setMigrationLog(JSON.stringify(result, null, 2));
                            })
                            .catch((_error) => {
                                // sometimes, we ignore, the error has been "telemetryzied" anyway
                            });
                    }}
                >
                    Migrate to MongoDB vCore [no error]
                </Button>
                <Button appearance="primary">Migrate to MongoDB RU on Azure</Button>
                <Button
                    appearance="secondary"
                    onClick={() => {
                        /**
                         * a simple call with no parameters, but with error handling.
                         * telemetry is "added " in the router for the function call
                         */

                        trpcClient.mongoMigration.sayMyName
                            .query('error')
                            .then((result) => {
                                setMigrationLog(JSON.stringify(result, null, 2));
                            })
                            .catch((error) => {
                                void trpcClient.common.displayErrorMessage.mutate({
                                    message: 'Error while loading the data',
                                    modal: false,
                                    cause: error instanceof Error ? error.message : String(error),
                                });
                            });
                    }}
                >
                    Preview Migration Plan [Error]
                </Button>
            </div>
            <div className="cardContainer">
                <Card>
                    <CardHeader>
                        <strong>Migration Configuration</strong>
                    </CardHeader>
                    <div className="cardBody" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div className="formGroup">
                            <Label htmlFor="sourceCluster">Source MongoDB Cluster</Label>
                            <Select id="sourceCluster">
                                <option>Cluster A</option>
                                <option>Cluster B</option>
                                <option>Cluster C</option>
                            </Select>
                        </div>
                        <div className="formGroup">
                            <Label htmlFor="targetOption">Target MongoDB Option</Label>
                            <Select id="targetOption">
                                <option>vCore</option>
                                <option>RU on Azure</option>
                            </Select>
                        </div>
                        <div className="formGroup">
                            <Label htmlFor="dbName">Database Name</Label>
                            <Input id="dbName" type="text" placeholder="Enter database name" />
                        </div>
                        <div className="formGroup">
                            <Switch label="Enable Advanced Options" />
                        </div>
                    </div>
                </Card>
            </div>
            <Card className="migrationLogCard">
                <CardHeader>
                    <strong>Migration Log</strong>
                </CardHeader>
                <div className="cardBody">
                    <textarea style={{ width: '100%', height: '150px' }} value={migrationLog} readOnly />
                </div>
            </Card>
        </div>
    );
};

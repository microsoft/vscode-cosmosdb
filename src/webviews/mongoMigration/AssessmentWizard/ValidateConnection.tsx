/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    Button,
    Card,
    CardHeader,
    Input,
    Link,
    Text
} from '@fluentui/react-components';
import { Eye24Regular, EyeOff24Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { FormInputRow } from '../Utils/FormInputRow';
import { extractHost } from '../Utils/apiUtils';
import './AssessmentWizardView.css';

const connectionStringVsCode =
    'mongodb+srv://bharath:bharath@m0-cluster-1.v5ezy.mongodb.net/?retryWrites=true&w=majority&connectTimeoutMS=10000';


interface Props {
    onCancel: () => void;
    runValidation: () => void;
}
export const ValidateConnections = ({ onCancel, runValidation }: Props) => {
    const [showReadOnlyConnectionString, setShowReadOnlyConnectionString] = useState(false);
    const hostName = extractHost(connectionStringVsCode);

    return (
        <>
            <h2>Validate your MongoDB server connection</h2>
            <Text>
                We need to verify the credentials, prerequisites, and connectivity before getting started.{' '}
                <Link href="https://aka.ms/mongo-assessment-prereq" target="_blank">
                    Learn More
                </Link>
            </Text>

            <Card>
                <CardHeader>
                    <strong>Connection Details</strong>
                </CardHeader>
                <div className="cardBody">
                    <FormInputRow
                        id="connectionStringDisplay"
                        label="Connection String"
                        required
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Input
                                value={connectionStringVsCode}
                                disabled
                                type={showReadOnlyConnectionString ? 'text' : 'password'}
                                style={{ width: '50%' }}
                            />
                            <Button
                                icon={showReadOnlyConnectionString ? <EyeOff24Regular /> : <Eye24Regular />}
                                appearance="subtle"
                                onClick={() => setShowReadOnlyConnectionString(prev => !prev)}
                                style={{ minWidth: 'auto', padding: '4px' }}
                            />
                        </div>
                    </FormInputRow>

                    <FormInputRow
                        id="hostNameDisplay"
                        label="Host Name"
                        required
                    >
                        <Input
                            value={hostName}
                            disabled
                            style={{ width: '50%' }}
                        />
                    </FormInputRow>
                </div>
            </Card>

            <div className="stepActions">
                <Button appearance="primary" onClick={() => void runValidation()}>
                    Run Validation
                </Button>
                <Button appearance="secondary" onClick={onCancel}>
                    Close
                </Button>
            </div>
        </>
    );
};

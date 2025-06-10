/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    Button,
    Card,
    CardHeader,
    Select,
    Text
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { fetchAssessments } from '../Utils/ApiUtils';
import { FormInputRow } from '../Utils/FormInputRow';

interface Props {
    onStart: (params: {
        assessmentName: string;
        offering: string;
        logFolderPath?: string;
        dataAssessmentReportPath?: string;
    }) => void;
    onCancel: () => void;
}

export const StartAssessment: React.FC<Props> = ({ onStart, onCancel }) => {
    const [assessmentName, setAssessmentName] = useState('');
    const [offering, setOffering] = useState<string>('2');
    const [logFolderPath, setLogFolderPath] = useState('');
    const [dataAssessmentReportPath, setDataAssessmentReportPath] = useState('');
    const [existingNames, setExistingNames] = useState<string[]>([]);
    const [errors, setErrors] = useState<{
        assessmentName: string | null;
        offering: string | null;
    }>({
        assessmentName: null,
        offering: null,
    });
    const { trpcClient } = useTrpcClient();

    useEffect(() => {
        const load = async () => {
            const data = await fetchAssessments(trpcClient);
            const names = data.map((a) => a.AssessmentName.toLowerCase());
            setExistingNames(names);
        };
        load();
    }, []);

    const validateFields = () => {
        const newErrors = {
            offering: offering === '' ? 'Offering is required' : null,
            assessmentName: null as string | null,
        };

        const lower = assessmentName.toLowerCase();
        const alphabetCount = (assessmentName.match(/[a-zA-Z]/g) || []).length;

        if (!assessmentName.trim()) {
            newErrors.assessmentName = 'Assessment name is required';
        } else if (alphabetCount < 3) {
            newErrors.assessmentName = 'Must contain at least 3 alphabets';
        } else if (existingNames.includes(lower)) {
            newErrors.assessmentName = 'Assessment name already exists';
        }

        setErrors(newErrors);
        return Object.values(newErrors).every((e) => e === null);
    };


    const handleStart = () => {
        if (!validateFields()) return;
        onStart({ assessmentName, offering, logFolderPath, dataAssessmentReportPath });
    };

    return (
        <>
            <h2>Run a new assessment of your MongoDB server</h2>
            <Text>
                Provide the assessment inputs to begin the process.
            </Text>

            <Card>
                <CardHeader>
                    <strong>Assessment Configuration</strong>
                </CardHeader>
                <div className="cardBody">
                    <FormInputRow
                        id="assessmentName"
                        label="Assessment name"
                        placeholder="Enter assessment name"
                        required
                        value={assessmentName}
                        onChange={setAssessmentName}
                        validationState={errors.assessmentName ? 'error' : undefined}
                        validationMessage={errors.assessmentName || undefined}
                    />

                    <FormInputRow
                        id="offering"
                        label="Offering"
                        required
                        validationState={errors.offering ? 'error' : undefined}
                        validationMessage={errors.offering || undefined}
                    >
                        <Select
                            value={offering}
                            onChange={(_, data) => setOffering(data.value)}
                            style={{ width: '50%', height: '30px' }}
                        >
                            <option value="2">vCore</option>
                            <option value="1">RU</option>
                        </Select>
                    </FormInputRow>

                    <FormInputRow
                        id="logFolderPath"
                        label="[Optional] Log folder path"
                        placeholder="Enter log folder path"
                        value={logFolderPath}
                        onChange={setLogFolderPath}
                        link={{
                            href: 'https://aka.ms/dmamongo-collect-log-messages',
                            text: 'How do I get the log folder path?',
                        }}
                    />

                    <FormInputRow
                        id="dataAssessmentReportPath"
                        label="[Optional] Data assessment report path"
                        placeholder="Enter data assessment report path"
                        value={dataAssessmentReportPath}
                        onChange={setDataAssessmentReportPath}
                        link={{
                            href: 'https://aka.ms/MongoMigrationDataAssessment',
                            text: 'How do I generate the data assessment report?',
                        }}
                    />
                </div>
            </Card>

            <div className="stepActions">
                <Button appearance="primary" onClick={handleStart}>
                    Start Assessment
                </Button>
                <Button appearance="secondary" onClick={onCancel}>
                    Close
                </Button>
            </div>
        </>
    );
};

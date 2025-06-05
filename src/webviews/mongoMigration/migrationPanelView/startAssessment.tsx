/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    Button,
    Card,
    CardHeader,
    Dropdown,
    Option,
    Text
} from '@fluentui/react-components';
import { FormInputRow } from './Utils/FormInputRow';

interface Props {
    assessmentName: string;
    offering: string;
    errors: {
        assessmentName: string | null;
        offering: string | null;
    };
    setAssessmentName: (val: string) => void;
    setOffering: (val: string) => void;
    onStart: () => void;
    onCancel: () => void;
}

export const StartAssessment: React.FC<Props> = ({
    assessmentName,
    offering,
    errors,
    setAssessmentName,
    setOffering,
    onStart,
    onCancel,
}) => {
    return (
        <>
            <h2>Run a new assessment of your MongoDB server</h2>
            <Text>
                Before we start migration, we need to assess your MongoDB server.
                By default, the assessment is run on the whole server.
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
                        <Dropdown
                            selectedValue={offering}
                            onOptionSelect={(_, data) => {
                                setOffering(data.optionValue ?? '');
                            }}
                            style={{ width: '50%', height: '30px' }}
                        >
                            <Option key="vCore" value="2">vCore</Option>
                            <Option key="ru" value="1">RU</Option>
                        </Dropdown>
                    </FormInputRow>

                    <FormInputRow
                        id="logFolderPath"
                        label="[Optional] Log folder path"
                        placeholder="Enter log folder path"
                        link={{
                            href: "https://aka.ms/dmamongo-collect-log-messages",
                            text: "How do I get the log folder path?",
                        }}
                    />
                    <FormInputRow
                        id="dataAssessmentReportPath"
                        label="[Optional] Data assessment report path"
                        placeholder="Enter data assessment report path"
                        link={{
                            href: "https://aka.ms/MongoMigrationDataAssessment",
                            text: "How do I generate the data assessment report?",
                        }}
                    />
                </div>
            </Card>

            <div className="stepActions">
                <Button appearance="primary" onClick={() => void onStart()}>
                    Start Assessment
                </Button>
                <Button appearance="secondary" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </>
    );
};

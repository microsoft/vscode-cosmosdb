/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { useState } from 'react';
import { AssessmentWizardView } from './AssessmentWizardView';

const useStyles = makeStyles({
    container: {
        marginTop: '10px',
        padding: '16px',
        width: '100%',
        height: '100%',
        overflowY: 'auto',
    },
    card: {
        width: '100%',
        maxWidth: '400px',
        cursor: 'pointer',
        border: '1px solid #d1d1d1',
        borderRadius: '8px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: '0 0 4px rgba(0, 0, 0, 0.08)',
        transition: 'box-shadow 0.2s ease-in-out',
        ':hover': {
            boxShadow: '0 0 0 2px #0078d4',
        },
        marginBottom: '20px',
    },
    title: {
        fontWeight: '600',
        fontSize: '16px',
    },
    subtitle: {
        color: '#666',
        fontSize: '14px',
    },
    sectionTitle: {
        fontSize: '20px',
        fontWeight: 600,
        marginBottom: '12px',
    },
    paragraph: {
        marginBottom: '20px',
        fontSize: '14px',
        lineHeight: 1.5,
    },
    sectionContainer: {
        display: 'flex',
        gap: '24px',
        marginTop: '24px',
        flexWrap: 'wrap',
    },
    cardBox: {
        flex: 1,
        width: '50%',
        border: '1px solid #ccc',
        borderRadius: '8px',
        padding: '16px',
    },
    migrationHint: {
        marginTop: '10px',
        fontSize: '13px',
        color: '#666',
    },
});

export const MigrationDashboardTab = () => {
    const classes = useStyles();
    const [showAssessmentWizard, setShowAssessmentWizard] = useState(false);

    if (showAssessmentWizard) {
        return (
            <div className={classes.container}>
                <AssessmentWizardView onCancel={() => setShowAssessmentWizard(false)} />
            </div>
        );
    }

    return (
        <div>
            <div
                className={classes.container}
                onClick={() => {
                    setShowAssessmentWizard(true);
                }}
            >
                <div className={classes.sectionTitle}>Azure Cosmos DB Migration for MongoDB</div>
                <div className={classes.paragraph}>
                    This extension helps you run an end-to-end assessment on your MongoDB workload and seamlessly
                    migrate your workload to Azure Cosmos DB for MongoDB.
                </div>

                <div className={classes.card}>
                    <div className={classes.title}>Assess Database(s)</div>
                    <div className={classes.subtitle}>
                        Conduct a workload assessment and then migrate to Azure Cosmos DB.
                    </div>
                </div>
            </div>
        </div>
    );
};

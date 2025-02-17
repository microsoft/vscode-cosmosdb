/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    Button,
    Card,
    CardHeader,
    Input,
    Label,
    Select,
    Switch,
} from '@fluentui/react-components';
import {
    Circle20Filled,
    Circle20Regular, // incomplete step icon (empty circle)
    Record20Filled, // current step icon ("circlish")
} from '@fluentui/react-icons';
import React, { useState, type JSX } from 'react';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import './demoView.scss';
import { type DemoViewWebviewConfigurationType } from './demoViewController';

export const DemoView = (): JSX.Element => {
  const configuration = useConfiguration<DemoViewWebviewConfigurationType>();
  const [migrationLog, setMigrationLog] = useState<string>('');

  // Define wizard steps
  const steps = [
    { key: 'configuration', text: 'Configuration' },
    { key: 'connect', text: 'Connect' },
    { key: 'preview', text: 'Preview' },
    { key: 'migrate', text: 'Migrate' },
  ];
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Allow navigation only to steps before the current one
  const onBreadcrumbClick = (index: number) => {
    if (index < currentStepIndex) {
      setCurrentStepIndex(index);
    }
  };

  // Render step navigation actions above the content
  const renderStepActions = () => {
    switch (currentStepIndex) {
      case 0:
        return (
          <Button appearance="primary" onClick={() => setCurrentStepIndex(1)}>
            Next
          </Button>
        );
      case 1:
        return (
          <>
            <Button appearance="secondary" onClick={() => setCurrentStepIndex(0)}>
              Back
            </Button>
            <Button
              appearance="primary"
              onClick={() => {
                setMigrationLog('Connected to MongoDB Cluster successfully.');
                setCurrentStepIndex(2);
              }}
            >
              Next
            </Button>
          </>
        );
      case 2:
        return (
          <>
            <Button appearance="secondary" onClick={() => setCurrentStepIndex(1)}>
              Back
            </Button>
            <Button
              appearance="primary"
              onClick={() =>
                setMigrationLog('Migration plan previewed with no errors.')
              }
            >
              Preview Migration Plan
            </Button>
            <Button appearance="primary" onClick={() => setCurrentStepIndex(3)}>
              Next
            </Button>
          </>
        );
      case 3:
        return (
          <>
            <Button appearance="secondary" onClick={() => setCurrentStepIndex(2)}>
              Back
            </Button>
            <Button
              appearance="primary"
              onClick={() =>
                setMigrationLog('Migrated to MongoDB vCore successfully.')
              }
            >
              Migrate to MongoDB vCore
            </Button>
            <Button
              appearance="primary"
              onClick={() =>
                setMigrationLog('Migrated to MongoDB RU on Azure successfully.')
              }
            >
              Migrate to MongoDB RU on Azure
            </Button>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="documentView">
      {/* Breadcrumb progress indicator with chevron dividers */}
      <Breadcrumb aria-label="Wizard progress" className="wizardBreadcrumb">
        {steps.map((step, index) => (
          <React.Fragment key={step.key}>
            {index > 0 && <BreadcrumbDivider />}
            <BreadcrumbItem>
              <BreadcrumbButton
                onClick={index < currentStepIndex ? () => onBreadcrumbClick(index) : undefined}
                current={index === currentStepIndex}
                icon={
                  index < currentStepIndex ? (
                    <Circle20Filled />
                  ) : index === currentStepIndex ? (
                    <Record20Filled />
                  ) : (
                    <Circle20Regular />
                  )
                }
              >
                {step.text}
              </BreadcrumbButton>
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </Breadcrumb>

      <h1>{`Migrate ${configuration.databaserName}`}</h1>

      {/* Navigation actions placed above the content */}
      <div className="stepActions" style={{ marginBottom: '20px' }}>
        {renderStepActions()}
      </div>

      {/* Step content */}
      {currentStepIndex === 0 && (
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
      )}

      {currentStepIndex === 1 && (
        <Card>
          <CardHeader>
            <strong>Connect to MongoDB Cluster</strong>
          </CardHeader>
          <div className="cardBody">
            <p>
              Please click the "Connect to MongoDB Cluster" button above to establish a connection.
            </p>
          </div>
        </Card>
      )}

      {(currentStepIndex === 2 || currentStepIndex === 3) && (
        <Card className="migrationLogCard">
          <CardHeader>
            <strong>Migration Log</strong>
          </CardHeader>
          <div className="cardBody">
            <textarea style={{ width: '100%', height: '150px' }} value={migrationLog} readOnly />
          </div>
        </Card>
      )}
    </div>
  );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { type JSX } from 'react';
import { Container } from '../Container/Container.js';
import { ContainerBody } from '../Container/ContainerBody.js';
import { ContainerMain } from '../Container/ContainerMain.js';
import { ContainerNav } from '../Container/ContainerNav.js';
import { ContainerSection } from '../Container/ContainerSection.js';
import { StepList } from '../StepList/StepList.js';
import { StepListItem } from '../StepList/StepListItem.js';
import { collectMarkerChildren } from '../utils/markerChildren.js';
import { type WizardProps, type WizardStepProps } from './Wizard.types.js';
import { wizardStepBrand } from './WizardStep.js';
import { defaultCompleted, defaultNavigable } from './wizardStepState.js';

const useStyles = makeStyles({
    // Sticky-chrome layout: header + step indicator are a pinned top band, the step body is the
    // only thing that scrolls, and the footer stays pinned by living outside the scroll region.
    stickyTop: { flexShrink: 0 },
    stickyTopInner: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        width: '100%',
        padding: '24px 24px 0',
        boxSizing: 'border-box',
    },
    scrollArea: { flex: 1, minHeight: 0, overflowY: 'auto' },
    scrollInner: { width: '100%', padding: '12px 24px 24px', boxSizing: 'border-box' },
    divider: { borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
});

/**
 * A whole wizard surface: header, step indicator, the active step's content, and a pinned footer.
 *
 * Built entirely on the public `Container` and `StepList` API, so a consumer who outgrows it can
 * take those same pieces and assemble the surface by hand. There is a step down, not a cliff.
 *
 * ```tsx
 * <Wizard
 *     activeStep={currentStep}
 *     onStepChange={goToStep}
 *     stepsAriaLabel="Setup steps"
 *     header={<ContainerHeader media={<RocketRegular />} title="DocumentDB Local" />}
 *     footer={<ContainerFooter note={note}><Button appearance="primary">Start</Button></ContainerFooter>}
 * >
 *     <WizardStep value="introduction" label="Introduction" subtitle="…">…</WizardStep>
 *     <WizardStep value="configure" label="Configure">…</WizardStep>
 * </Wizard>
 * ```
 *
 * Controlled, and it owns no navigation logic. `activeStep` is a string the consumer computes, and
 * how they arrive at it is never visible here: two situations may share one step and branch inside
 * its children, and a step that does not apply is simply not rendered.
 *
 * Only the active step is mounted, so a heavy step body does not stay resident, and
 * focus-on-mount falls out of mounting rather than needing a rule of its own.
 *
 * **Children must be `WizardStep`, `false` or `null`.** A fragment of steps is ignored, because a
 * fragment has no props to read.
 */
export const Wizard = ({
    activeStep,
    onStepChange,
    navPosition = 'top',
    stepsLocked = false,
    stepsAriaLabel,
    overflowAriaLabel,
    stickyChrome = false,
    header,
    footer,
    children,
}: WizardProps): JSX.Element => {
    const styles = useStyles();
    const steps = collectMarkerChildren<WizardStepProps>(children, wizardStepBrand);
    const activeIndex = steps.findIndex((step) => step.props.value === activeStep);
    const active = activeIndex === -1 ? undefined : steps[activeIndex];

    const stepList = (
        <ContainerNav>
            <StepList
                vertical={navPosition === 'start'}
                selectedValue={activeStep}
                onStepSelect={(_event, data) => onStepChange(data.value)}
                ariaLabel={stepsAriaLabel}
                overflowAriaLabel={overflowAriaLabel}
            >
                {steps.map((step, index) => (
                    <StepListItem
                        key={step.props.value}
                        value={step.props.value}
                        completed={step.props.completed ?? defaultCompleted(index, activeIndex, steps.length)}
                        navigable={step.props.navigable ?? defaultNavigable(index, activeIndex, stepsLocked)}
                    >
                        {step.props.label}
                    </StepListItem>
                ))}
            </StepList>
        </ContainerNav>
    );

    const activeSection = active && (
        // `key` is what makes focus-on-mount fire on every step change, and what
        // unmounts the previous step's body.
        <ContainerSection
            key={active.props.value}
            title={active.props.title ?? active.props.label}
            subtitle={active.props.subtitle}
            action={active.props.action}
            focusOnMount
        >
            {active.props.children}
        </ContainerSection>
    );

    // Sticky-chrome mode (top nav only): pin the header + step indicator, scroll just the body.
    // The step content lives in its own scroll region instead of `ContainerBody`, so header and
    // nav sit above it as a fixed band rather than scrolling away with the content.
    if (stickyChrome && navPosition === 'top') {
        return (
            <Container>
                <div className={styles.stickyTop}>
                    <div className={styles.stickyTopInner}>
                        {header}
                        {stepList}
                    </div>
                </div>
                <div className={`${styles.scrollArea} ${styles.divider}`}>
                    <div className={styles.scrollInner}>
                        <ContainerMain>{activeSection}</ContainerMain>
                    </div>
                </div>
                {footer}
            </Container>
        );
    }

    return (
        <Container>
            <ContainerBody navPosition={navPosition}>
                {header}
                {stepList}
                <ContainerMain>{activeSection}</ContainerMain>
            </ContainerBody>
            {footer}
        </Container>
    );
};

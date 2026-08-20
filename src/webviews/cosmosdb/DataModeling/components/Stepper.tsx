/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Fragment } from 'react';
import { type WizardStepDescriptor } from '../models';

/**
 * Horizontal step indicator. Steps at or before the current one are clickable
 * so the user can jump back; forward steps are disabled until reachable.
 */

const useStyles = makeStyles({
    root: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalXS,
        flexWrap: 'wrap',
        marginBottom: tokens.spacingVerticalXL,
    },
    step: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.spacingVerticalXXS,
        flex: '0 0 auto',
        minWidth: '64px',
    },
    num: {
        width: '28px',
        height: '28px',
        borderRadius: tokens.borderRadiusCircular,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground2,
        fontWeight: tokens.fontWeightSemibold,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ':disabled': {
            cursor: 'default',
            opacity: 0.6,
        },
    },
    numActive: {
        backgroundColor: tokens.colorBrandBackground,
        border: `1px solid ${tokens.colorBrandBackground}`,
        color: tokens.colorNeutralForegroundOnBrand,
    },
    numDone: {
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorBrandStroke1}`,
        color: tokens.colorBrandForeground1,
    },
    label: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
        textAlign: 'center',
    },
    labelActive: {
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    sub: {
        fontSize: tokens.fontSizeBase100,
        color: tokens.colorNeutralForeground4,
        textAlign: 'center',
        maxWidth: '96px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    line: {
        flex: '1 1 12px',
        height: '1px',
        minWidth: '12px',
        marginTop: '14px',
        backgroundColor: tokens.colorNeutralStroke2,
        '@media (max-width: 600px)': {
            display: 'none',
        },
    },
});

export interface StepperProps {
    steps: WizardStepDescriptor[];
    current: number;
    /** Highest step the user has reached (controls how far forward they can jump). */
    maxReached: number;
    subtitles?: Record<number, string | undefined>;
    onNavigate: (step: number) => void;
}

export function Stepper({ steps, current, maxReached, subtitles, onNavigate }: StepperProps) {
    const styles = useStyles();
    return (
        <nav className={styles.root} aria-label="Wizard steps">
            {steps.map((step, i) => {
                const isActive = step.index === current;
                const isDone = step.index < current;
                const reachable = step.index <= maxReached;
                const sub = subtitles?.[step.index];
                return (
                    <Fragment key={step.index}>
                        {i > 0 ? <span className={styles.line} aria-hidden="true" /> : null}
                        <div className={styles.step}>
                            <button
                                type="button"
                                disabled={!reachable}
                                aria-current={isActive ? 'step' : undefined}
                                aria-label={`Go to ${step.label} step`}
                                className={mergeClasses(
                                    styles.num,
                                    isActive && styles.numActive,
                                    isDone && styles.numDone,
                                )}
                                onClick={() => reachable && onNavigate(step.index)}
                            >
                                {step.index}
                            </button>
                            <span className={mergeClasses(styles.label, isActive && styles.labelActive)}>
                                {step.label}
                            </span>
                            {sub ? <span className={styles.sub}>{sub}</span> : null}
                        </div>
                    </Fragment>
                );
            })}
        </nav>
    );
}

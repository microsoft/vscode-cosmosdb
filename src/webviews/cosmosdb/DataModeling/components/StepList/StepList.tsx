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
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Overflow,
    OverflowDivider,
    OverflowItem,
    tokens,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from '@fluentui/react-components';
import {
    bundleIcon,
    CheckmarkCircleFilled,
    CircleHintFilled,
    MoreHorizontalFilled,
    MoreHorizontalRegular,
} from '@fluentui/react-icons';
import { Fragment, type JSX, type ReactNode, type SyntheticEvent } from 'react';
import { collectMarkerChildren } from '../utils/markerChildren.js';
import { type StepListItemProps, type StepListItemSelectData, type StepListProps } from './StepList.types.js';
import { stepListItemBrand } from './StepListItem.js';

const MoreHorizontal = bundleIcon(MoreHorizontalFilled, MoreHorizontalRegular);

/**
 * The package ships no localization: `npm run l10n` extractors do not scan `node_modules`, so a
 * string owned here would silently never be translated in any consumer.
 */
const defaultOverflowAriaLabel = (count: number): string => `${count} more steps`;

/** A step, with the state `StepList` derived for it. */
interface ResolvedStep {
    readonly value: string;
    readonly label: ReactNode;
    readonly isCurrent: boolean;
    readonly isCompleted: boolean;
    readonly canNavigate: boolean;
}

const useStyles = makeStyles({
    breadcrumb: { minWidth: 0, overflow: 'hidden' },
    done: { color: tokens.colorPaletteGreenForeground1, fontSize: '16px' },
    // Inherit the breadcrumb button's own text colour, so the hint dot matches whatever state the
    // step is in (the active/current item gets its colour for free).
    pending: { color: 'inherit', fontSize: '16px' },
    // Keep completed steps bold. Fluent only bolds the `current` item, so a step dropped back to
    // regular weight when it stopped being current, and the width change shifted the whole row.
    buttonDone: { fontWeight: tokens.fontWeightSemibold },
});

/** Renders a hidden (overflowed) step as a menu item; visible steps render nothing here. */
const StepOverflowMenuItem = ({
    step,
    onStepSelect,
}: {
    readonly step: ResolvedStep;
    readonly onStepSelect: (event: SyntheticEvent, data: StepListItemSelectData) => void;
}): JSX.Element | null => {
    const isVisible = useIsOverflowItemVisible(step.value);
    if (isVisible) {
        return null;
    }
    return (
        <MenuItem
            disabled={!step.canNavigate}
            onClick={step.canNavigate ? (event) => onStepSelect(event, { value: step.value }) : undefined}
        >
            {step.label}
        </MenuItem>
    );
};

/** The "…" entry that collects steps hidden by overflow. Renders nothing until there is overflow. */
const StepOverflowMenu = ({
    steps,
    onStepSelect,
    overflowAriaLabel,
}: {
    readonly steps: readonly ResolvedStep[];
    readonly onStepSelect: (event: SyntheticEvent, data: StepListItemSelectData) => void;
    readonly overflowAriaLabel: (count: number) => string;
}): JSX.Element | null => {
    const { ref, isOverflowing, overflowCount } = useOverflowMenu<HTMLButtonElement>();
    if (!isOverflowing) {
        return null;
    }
    return (
        <BreadcrumbItem>
            <Menu>
                <MenuTrigger disableButtonEnhancement>
                    <Button
                        appearance="subtle"
                        ref={ref}
                        icon={<MoreHorizontal />}
                        aria-label={overflowAriaLabel(overflowCount)}
                    />
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        {steps.map((step) => (
                            <StepOverflowMenuItem key={step.value} step={step} onStepSelect={onStepSelect} />
                        ))}
                    </MenuList>
                </MenuPopover>
            </Menu>
        </BreadcrumbItem>
    );
};

/**
 * Responsive wizard step indicator, in the shape of Fluent's `TabList`: `selectedValue`,
 * `onStepSelect`, and `StepListItem` children that describe the sequence.
 *
 * When the row does not fit, steps collapse into a "…" menu. The current step carries the highest
 * overflow priority, so it is the last item overflow ever removes: it never hides.
 *
 * ```tsx
 * <StepList selectedValue={step} onStepSelect={(_e, d) => goTo(d.value)} ariaLabel="Setup steps">
 *     <StepListItem value="introduction" completed>Introduction</StepListItem>
 *     <StepListItem value="configure" completed navigable>Configure</StepListItem>
 *     <StepListItem value="setup">Set up</StepListItem>
 * </StepList>
 * ```
 */
export const StepList = ({
    selectedValue,
    onStepSelect,
    ariaLabel,
    overflowAriaLabel = defaultOverflowAriaLabel,
    children,
}: StepListProps): JSX.Element => {
    const styles = useStyles();

    const steps: readonly ResolvedStep[] = collectMarkerChildren<StepListItemProps>(children, stepListItemBrand).map(
        (child) => ({
            value: child.props.value,
            label: child.props.children,
            isCurrent: child.props.value === selectedValue,
            isCompleted: child.props.completed === true,
            canNavigate: child.props.navigable === true,
        }),
    );

    return (
        <Overflow minimumVisible={1}>
            <Breadcrumb aria-label={ariaLabel} className={styles.breadcrumb}>
                {steps.map((step, index) => (
                    <Fragment key={step.value}>
                        <OverflowItem
                            id={step.value}
                            groupId={step.value}
                            priority={step.isCurrent ? steps.length + 1 : 0}
                        >
                            <BreadcrumbItem>
                                <BreadcrumbButton
                                    current={step.isCurrent}
                                    aria-current={step.isCurrent ? 'step' : undefined}
                                    disabledFocusable={!step.isCurrent && !step.canNavigate}
                                    className={step.isCompleted ? styles.buttonDone : undefined}
                                    icon={
                                        step.isCompleted ? (
                                            <CheckmarkCircleFilled aria-hidden className={styles.done} />
                                        ) : (
                                            <CircleHintFilled aria-hidden className={styles.pending} />
                                        )
                                    }
                                    onClick={
                                        step.canNavigate
                                            ? (event) => onStepSelect(event, { value: step.value })
                                            : undefined
                                    }
                                >
                                    {step.label}
                                </BreadcrumbButton>
                            </BreadcrumbItem>
                        </OverflowItem>
                        {index < steps.length - 1 && (
                            <OverflowDivider groupId={step.value}>
                                <BreadcrumbDivider />
                            </OverflowDivider>
                        )}
                    </Fragment>
                ))}
                <StepOverflowMenu steps={steps} onStepSelect={onStepSelect} overflowAriaLabel={overflowAriaLabel} />
            </Breadcrumb>
        </Overflow>
    );
};

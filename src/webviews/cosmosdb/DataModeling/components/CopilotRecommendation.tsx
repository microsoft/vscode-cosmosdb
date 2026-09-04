/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Spinner, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';

/** Lifecycle of the Copilot partition-key recommendation request. */
export type RecommendationStatus = 'idle' | 'waiting' | 'received' | 'error';

const useStyles = makeStyles({
    panel: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalL,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorBrandStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
    headerIcon: {
        color: tokens.colorBrandForeground1,
        fontSize: tokens.fontSizeBase500,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
    },
    error: {
        color: tokens.colorPaletteRedForeground1,
    },
});

export interface CopilotRecommendationStatusProps {
    status: RecommendationStatus;
    error?: string;
    onRetry: () => void;
}

/**
 * Status panel for the Copilot recommendation request. Renders the idle prompt, the in-flight
 * waiting note, or an error with a retry. The `received` payload is rendered by the Result page
 * itself, so this component shows nothing in that state.
 */
export function CopilotRecommendation({ status, error, onRetry }: CopilotRecommendationStatusProps) {
    const styles = useStyles();

    if (status === 'received') {
        return null;
    }

    return (
        <section className={styles.panel} aria-live="polite">
            <div className={styles.header}>
                <SparkleRegular className={styles.headerIcon} aria-hidden="true" />
                <Text className={styles.title}>{l10n.t("Copilot's recommendation")}</Text>
            </div>

            {status === 'idle' ? (
                <div className={styles.row}>
                    <Text>{l10n.t('Ask Copilot to recommend the best partition key for this model.')}</Text>
                    <Button appearance="primary" onClick={onRetry}>
                        {l10n.t('Get Recommendation')}
                    </Button>
                </div>
            ) : null}

            {status === 'waiting' ? (
                <div className={styles.row}>
                    <Spinner size="tiny" />
                    <Text>
                        {l10n.t(
                            'Waiting for Copilot… We opened Copilot Chat with your data model. The recommendation will appear here.',
                        )}
                    </Text>
                </div>
            ) : null}

            {status === 'error' ? (
                <div className={styles.row}>
                    <Text className={styles.error}>
                        {error ?? l10n.t('Copilot could not produce a recommendation.')}
                    </Text>
                    <Button appearance="secondary" onClick={onRetry}>
                        {l10n.t('Try again')}
                    </Button>
                </div>
            ) : null}
        </section>
    );
}

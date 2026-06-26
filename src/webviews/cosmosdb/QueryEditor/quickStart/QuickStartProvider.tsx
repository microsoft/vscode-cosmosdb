/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@cosmosdb/webview-rpc/react';
import {
    Button,
    makeStaticStyles,
    makeStyles,
    Popover,
    PopoverSurface,
    tokens,
    useAnnounce,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { type QueryEditorAppRouter } from '../../../../panels/trpc/appRouter';
import { getTipsInSegment } from '../../../../utils/quickStart/quickStartState';
import { type QuickStartTip } from '../../../../utils/quickStart/quickStartTypes';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import {
    getQueryEditorTips,
    QUERY_EDITOR_RESULTS_TIP_GROUP,
    QUERY_EDITOR_TIP_GROUP,
    QUICK_START_GROUP_ORDER,
} from './queryEditorTips';
import { QuickStartEnabledContext } from './quickStartContext';
import { toFluentPositioning } from './quickStartPositioning';
import { onQuickStartReplay } from './quickStartReplay';

type TourTrigger = 'auto' | 'manual';

/**
 * A pending request to play one segment of the tour. `group` is a group id, or
 * `null` for the ungrouped intro tips. `trigger` decides whether seen tips are
 * filtered out (auto) or always shown (manual), and whether viewing a tip
 * persists "seen" state.
 */
interface SegmentRequest {
    group: string | null;
    trigger: TourTrigger;
}

interface Tour {
    tips: QuickStartTip[];
    index: number;
    trigger: TourTrigger;
}

// How long to wait for the FIRST target of a segment to mount before skipping it
// (toolbar/result controls mount asynchronously after the panel connects). Once
// one target has resolved, the rest are present too, so a missing target almost
// always means a hidden control — use a much shorter wait to keep the flow snappy.
const TARGET_WAIT_MS = 4000;
const TARGET_WAIT_SHORT_MS = 300;

// Class used to scope the arrow-border override below. Fluent draws the popover
// arrow as a ::before pseudo-element on a child <div>; griffel's makeStyles cannot
// emit a `<combinator> <tag>::before` selector, so the arrow outline is applied via
// a single scoped global rule. We prefer VS Code's own theme color so the arrow
// border matches the editor chrome exactly, falling back to the Fluent token.
const QUICK_START_TIP_CLASS = 'cosmosdb-quickstart-tip';

const useStaticStyles = makeStaticStyles({
    [`.${QUICK_START_TIP_CLASS} > div::before`]: {
        borderColor: 'var(--vscode-editorWidget-border, var(--colorNeutralStroke1))',
    },
});

const useStyles = makeStyles({
    surface: {
        maxWidth: '360px',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        // The default Fluent popover surface is barely brighter than the (dark)
        // editor behind it and its border/arrow use a near-transparent stroke, so
        // in dark theme the outline, the arrow and the body text are all hard to
        // read (fails contrast). Bind the colors to VS Code's own theme variables
        // — the same ones the editor uses for floating widgets — so the tip always
        // matches the active theme and stays legible, falling back to Fluent tokens
        // if the variables are ever unavailable. The arrow fill is `inherit`, so the
        // surface background carries over to it; its outline is restored above.
        backgroundColor: `var(--vscode-editorWidget-background, ${tokens.colorNeutralBackground1Hover})`,
        color: `var(--vscode-editorWidget-foreground, ${tokens.colorNeutralForeground1})`,
        border: `${tokens.strokeWidthThin} solid var(--vscode-editorWidget-border, ${tokens.colorNeutralStroke1})`,
    },
    header: {
        fontSize: tokens.fontSizeBase200,
        color: `var(--vscode-descriptionForeground, ${tokens.colorNeutralForeground3})`,
    },
    title: {
        margin: 0,
        fontSize: tokens.fontSizeBase500,
        lineHeight: tokens.lineHeightBase500,
        fontWeight: tokens.fontWeightSemibold,
    },
    body: {
        marginBottom: tokens.spacingVerticalM,
    },
    footer: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
    navButtons: {
        display: 'flex',
        gap: tokens.spacingHorizontalS,
    },
});

/**
 * Resolves a DOM element matching `selector`, waiting up to `timeoutMs` for it
 * to appear (toolbar controls mount asynchronously after the panel connects).
 * Resolves `null` if it never appears.
 */
function waitForElement(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
    const existing = document.querySelector<HTMLElement>(selector);
    if (existing) {
        return Promise.resolve(existing);
    }
    return new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
            const el = document.querySelector<HTMLElement>(selector);
            if (el) {
                resolve(el);
            } else if (Date.now() - start >= timeoutMs) {
                resolve(null);
            } else {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
    });
}

interface QuickStartStartupState {
    seenTipIds: string[];
    enabled: boolean;
    autoShowAllowed: boolean;
}

interface QuickStartTourProps {
    /** Startup state from the extension host, or `null` until it has loaded. */
    startup: QuickStartStartupState | null;
}

/**
 * Drives the Query Editor Quick Start tour as a staged flow. On a fresh install
 * or a major/minor extension upgrade (when the host says auto-show is allowed),
 * it replays the whole tour from scratch — one group at a time: the ungrouped
 * intro tips and the `editor` group when the editor opens, then the `result`
 * group after the user's first query. Segments are queued and played one at a
 * time, and the whole tour (or a single group) can be replayed on demand. The
 * last-seen version lives in the extension host and is reached through the
 * `quickStart` tRPC router.
 */
const QuickStartTour = ({ startup }: QuickStartTourProps) => {
    useStaticStyles();
    const styles = useStyles();
    const { trpcClient } = useTrpcClient<QueryEditorAppRouter>();
    const dispatcher = useQueryEditorDispatcher();
    const { announce } = useAnnounce();

    const [tour, setTour] = useState<Tour | null>(null);
    const [activeTarget, setActiveTarget] = useState<HTMLElement | null>(null);
    const state = useQueryEditorState();

    // Mirrors `tour` so the queue-pump logic can read the live value without
    // depending on a re-render (it shifts segments synchronously).
    const tourRef = useRef<Tour | null>(null);
    // Pending segments waiting to play, one at a time, in order.
    const queueRef = useRef<SegmentRequest[]>([]);
    // Whether at least one target in the current segment has resolved (controls
    // are mounted), so later missing targets can be skipped quickly.
    const resolvedAnyRef = useRef(false);

    // One-time guards so StrictMode double-invocation can't enqueue twice.
    const autoStartedRef = useRef(false);
    const resultStartedRef = useRef(false);

    // Tracks which tips already triggered "viewed" side effects (persistence +
    // telemetry) so re-renders / StrictMode double-invocation don't duplicate them.
    const viewedRef = useRef<Set<string>>(new Set());
    // Whether the one-time "tour shown" telemetry has fired for the current segment.
    const shownReportedRef = useRef(false);

    const report = useCallback(
        (eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>) => {
            void dispatcher.reportWebviewEvent(eventName, properties, measurements).catch(() => {
                /* telemetry is best-effort */
            });
        },
        [dispatcher],
    );

    const applyTour = useCallback((next: Tour | null) => {
        tourRef.current = next;
        setTour(next);
    }, []);

    // Builds the tips for a single segment (a group, or the ungrouped intro).
    // The whole tour is replayed from scratch on every major/minor upgrade, so
    // we never filter by "seen" — the version gate (autoShowAllowed) already
    // decides whether the auto tour runs at all.
    const buildSegmentTips = useCallback((request: SegmentRequest): QuickStartTip[] => {
        return getTipsInSegment(getQueryEditorTips(), request.group);
    }, []);

    // Starts the next non-empty queued segment, if nothing is currently playing.
    const pump = useCallback(() => {
        if (tourRef.current) {
            return;
        }
        while (queueRef.current.length > 0) {
            const request = queueRef.current.shift()!;
            const tips = buildSegmentTips(request);
            if (tips.length > 0) {
                viewedRef.current = new Set();
                shownReportedRef.current = false;
                resolvedAnyRef.current = false;
                applyTour({ tips, index: 0, trigger: request.trigger });
                return;
            }
        }
    }, [applyTour, buildSegmentTips]);

    const enqueue = useCallback(
        (requests: SegmentRequest[]) => {
            queueRef.current.push(...requests);
            pump();
        },
        [pump],
    );

    const endTour = useCallback(
        (reason: 'completed' | 'skipped') => {
            const current = tourRef.current;
            if (current) {
                const tip = current.tips[current.index];
                if (reason === 'completed') {
                    report('quickStartCompleted', { trigger: current.trigger });
                } else {
                    // Skipping abandons the rest of the queued segments too.
                    queueRef.current = [];
                    report(
                        'quickStartSkipped',
                        { trigger: current.trigger, tipId: tip.id },
                        { step: current.index + 1, totalSteps: current.tips.length },
                    );
                }
            }
            setActiveTarget(null);
            applyTour(null);
            // Play the next queued segment (a no-op after a skip cleared the queue).
            pump();
        },
        [applyTour, pump, report],
    );

    const goToIndex = useCallback(
        (nextIndex: number) => {
            applyTour(tourRef.current ? { ...tourRef.current, index: nextIndex } : null);
        },
        [applyTour],
    );

    // ── Auto-start on open: ungrouped intro tips, then the editor group ──────
    useEffect(() => {
        if (!startup || !startup.enabled || !startup.autoShowAllowed || autoStartedRef.current) {
            return;
        }
        autoStartedRef.current = true;
        enqueue([
            { group: null, trigger: 'auto' },
            { group: QUERY_EDITOR_TIP_GROUP, trigger: 'auto' },
        ]);
    }, [startup, enqueue]);

    // ── Auto-start the result group after the user's first query result ──────
    useEffect(() => {
        if (!startup || !startup.enabled || !startup.autoShowAllowed || resultStartedRef.current) {
            return;
        }
        if (state.currentQueryResult) {
            resultStartedRef.current = true;
            enqueue([{ group: QUERY_EDITOR_RESULTS_TIP_GROUP, trigger: 'auto' }]);
        }
    }, [startup, state.currentQueryResult, enqueue]);

    // ── Manual replay (only while the feature is enabled) ───────────────────
    useEffect(() => {
        if (startup && !startup.enabled) {
            return;
        }
        return onQuickStartReplay((group) => {
            if (group) {
                enqueue([{ group, trigger: 'manual' }]);
            } else {
                // No group: replay the whole tour — intro tips, then every group.
                enqueue([
                    { group: null, trigger: 'manual' },
                    ...QUICK_START_GROUP_ORDER.map((g) => ({ group: g, trigger: 'manual' as const })),
                ]);
            }
        });
    }, [startup, enqueue]);

    // ── Resolve the current tip's target; skip tips whose target is absent ──
    useEffect(() => {
        if (!tour) {
            return;
        }
        let cancelled = false;
        const tip = tour.tips[tour.index];
        // Allow the first target of a segment time to mount; once any target has
        // resolved, a missing one is a hidden control — skip it quickly.
        const timeout = resolvedAnyRef.current ? TARGET_WAIT_SHORT_MS : TARGET_WAIT_MS;

        void waitForElement(tip.targetSelector, timeout).then((el) => {
            if (cancelled) {
                return;
            }
            if (!el) {
                // Target never appeared (e.g. AI button hidden) — advance past it.
                if (tour.index < tour.tips.length - 1) {
                    goToIndex(tour.index + 1);
                } else {
                    endTour('completed');
                }
                return;
            }

            resolvedAnyRef.current = true;
            setActiveTarget(el);

            // One-time "tour shown" event.
            if (!shownReportedRef.current) {
                shownReportedRef.current = true;
                report('quickStartShown', { trigger: tour.trigger }, { totalSteps: tour.tips.length });
            }

            // Per-tip "viewed" side effects (persist on view + telemetry), once each.
            if (!viewedRef.current.has(tip.id)) {
                viewedRef.current.add(tip.id);
                report(
                    'quickStartStepViewed',
                    { trigger: tour.trigger, tipId: tip.id, group: tip.group ?? 'ungrouped' },
                    { step: tour.index + 1, totalSteps: tour.tips.length },
                );
                // Auto-runs stamp the current version (via markTipsSeen) so the
                // tour doesn't replay again until the next major/minor upgrade.
                // Manual replays must not touch persisted state.
                if (tour.trigger === 'auto') {
                    void trpcClient.quickStart.markTipsSeen.mutate({ ids: [tip.id] }).catch(() => {
                        /* best-effort */
                    });
                }
            }

            announce(`${l10n.t('Step {0} of {1}', tour.index + 1, tour.tips.length)}. ${tip.title}. ${tip.body}`, {
                polite: true,
            });
        });

        return () => {
            cancelled = true;
        };
    }, [tour, goToIndex, endTour, report, announce, trpcClient]);

    if (!tour || !activeTarget) {
        return null;
    }

    const tip = tour.tips[tour.index];
    const total = tour.tips.length;
    const isFirst = tour.index === 0;
    const isLast = tour.index === total - 1;
    const positioning = { target: activeTarget, ...toFluentPositioning(tip.position) };

    return (
        <Popover
            open
            trapFocus
            withArrow
            positioning={positioning}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    endTour('skipped');
                }
            }}
        >
            <PopoverSurface className={`${QUICK_START_TIP_CLASS} ${styles.surface}`} aria-label={tip.title}>
                <div className={styles.header}>{l10n.t('Step {0} of {1}', tour.index + 1, total)}</div>
                <h2 className={styles.title}>{tip.title}</h2>
                <div className={styles.body}>{tip.body}</div>
                <div className={styles.footer}>
                    <Button appearance="subtle" onClick={() => endTour('skipped')}>
                        {l10n.t('Skip')}
                    </Button>
                    <div className={styles.navButtons}>
                        {!isFirst && (
                            <Button appearance="secondary" onClick={() => goToIndex(tour.index - 1)}>
                                {l10n.t('Back')}
                            </Button>
                        )}
                        <Button
                            appearance="primary"
                            onClick={() => (isLast ? endTour('completed') : goToIndex(tour.index + 1))}
                        >
                            {isLast ? l10n.t('Done') : l10n.t('Next')}
                        </Button>
                    </div>
                </div>
            </PopoverSurface>
        </Popover>
    );
};

/**
 * Isolates the Quick Start tour from the rest of the Query Editor. The tour is
 * a non-essential onboarding overlay; if anything inside it throws, it must
 * never bubble up to the Query Editor's top-level error boundary and blank the
 * whole editor. On error we simply render nothing — the editor stays fully usable.
 */
class QuickStartTourBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): { hasError: boolean } {
        return { hasError: true };
    }

    override render(): ReactNode {
        return this.state.hasError ? null : this.props.children;
    }
}

/**
 * Mounts the Quick Start engine and shares the resolved `enabled` flag with the
 * rest of the Query Editor (notably the toolbar replay button) via context. The
 * startup state — seen ids, enabled, and whether the automatic tour may fire —
 * is fetched once from the extension host, which is the only side that can read
 * the extension version and user settings.
 */
export const QuickStartProvider = ({ children }: { children: ReactNode }) => {
    const { trpcClient } = useTrpcClient<QueryEditorAppRouter>();
    const [startup, setStartup] = useState<QuickStartStartupState | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const state = await trpcClient.quickStart.getStartupState.query();
                if (!cancelled) {
                    setStartup(state);
                }
            } catch {
                // If we can't read state, leave it null: no auto-tour, and the
                // replay button stays visible (enabled defaults to true).
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [trpcClient]);

    return (
        <QuickStartEnabledContext.Provider value={startup ? startup.enabled : true}>
            <QuickStartTourBoundary>
                <QuickStartTour startup={startup} />
            </QuickStartTourBoundary>
            {children}
        </QuickStartEnabledContext.Provider>
    );
};

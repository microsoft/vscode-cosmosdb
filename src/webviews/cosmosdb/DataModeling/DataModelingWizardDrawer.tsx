/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    makeStyles,
    OverlayDrawer,
    Text,
    tokens,
} from '@fluentui/react-components';
import { DismissRegular, PanelRightExpandRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useState } from 'react';
import { DataModelingWizard } from './DataModelingWizard';

/**
 * Hosts {@link DataModelingWizard} inside a right-side Fluent UI
 * {@link OverlayDrawer}. The drawer slides in over the webview surface and can
 * be dismissed; a launcher button re-opens it. The wizard content itself is
 * unchanged and stays fully reusable — only the surrounding chrome differs from
 * the full-page host.
 */

const useStyles = makeStyles({
    surface: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.spacingVerticalM,
        height: '100vh',
        boxSizing: 'border-box',
        padding: tokens.spacingHorizontalXXL,
        textAlign: 'center',
        color: tokens.colorNeutralForeground2,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    // Responsive drawer width: roomy on wide screens, full-bleed on narrow webviews.
    drawer: {
        width: 'min(640px, 100vw)',
        maxWidth: '100vw',
    },
    body: {
        // Let the wizard manage its own padding; remove the default drawer gutter
        // so the two-column pages get the full width.
        padding: 0,
    },
});

export const DataModelingWizardDrawer = () => {
    const styles = useStyles();
    const [open, setOpen] = useState(true);

    return (
        <>
            <div className={styles.surface}>
                <Text size={400} weight="semibold">
                    {l10n.t('Data Modeling')}
                </Text>
                <Text>{l10n.t('The partition-key advisor opens in a panel on the right.')}</Text>
                <Button appearance="primary" icon={<PanelRightExpandRegular />} onClick={() => setOpen(true)}>
                    {l10n.t('Open wizard')}
                </Button>
            </div>

            <OverlayDrawer
                className={styles.drawer}
                position="end"
                open={open}
                onOpenChange={(_, data) => setOpen(data.open)}
            >
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label={l10n.t('Close')}
                                icon={<DismissRegular />}
                                onClick={() => setOpen(false)}
                            />
                        }
                    >
                        {l10n.t('Data Modeling')}
                    </DrawerHeaderTitle>
                </DrawerHeader>
                <DrawerBody className={styles.body}>
                    <DataModelingWizard />
                </DrawerBody>
            </OverlayDrawer>
        </>
    );
};

export default DataModelingWizardDrawer;

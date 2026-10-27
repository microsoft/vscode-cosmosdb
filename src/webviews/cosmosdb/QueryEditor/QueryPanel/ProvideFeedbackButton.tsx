/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProvideFeedbackButton as SharedProvideFeedbackButton } from '../../../common/ProvideFeedbackButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher } from '../state/QueryEditorContext';

export const ProvideFeedbackButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const dispatcher = useQueryEditorDispatcher();
    return (
        <SharedProvideFeedbackButton
            {...props}
            quickStartId="provide-feedback"
            onProvideFeedback={() => dispatcher.provideFeedback()}
        />
    );
};

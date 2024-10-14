/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from '@fluentui/react-components';
import {
    DocumentAddRegular,
    DocumentArrowDownRegular,
    DocumentDismissRegular,
    DocumentEditRegular,
} from '@fluentui/react-icons';
import { useContext, type JSX } from 'react';
import { CollectionViewContext } from '../../collectionViewContext';

interface ToolbarDocumentsProps {
    onDeleteClick: () => void;
    onEditClick: () => void;
    onViewClick: () => void;
    onAddClick: () => void;
}

export const ToolbarDocuments = ({
    onDeleteClick,
    onEditClick,
    onViewClick,
    onAddClick,
}: ToolbarDocumentsProps): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    return (
        <Toolbar aria-label="with Popover" size="small">
            <ToolbarButton
                aria-label="Add new document"
                icon={<DocumentAddRegular />}
                disabled={currentContext.commands.disableAddDocument}
                onClick={onAddClick}
            />

            <ToolbarButton
                aria-label="View selected document"
                icon={<DocumentArrowDownRegular />}
                disabled={currentContext.commands.disableViewDocument}
                onClick={onViewClick}
            />

            <ToolbarButton
                aria-label="Edit selected document"
                icon={<DocumentEditRegular />}
                disabled={currentContext.commands.disableEditDocument}
                onClick={onEditClick}
            />

            <ToolbarButton
                aria-label="Delete selected document"
                icon={<DocumentDismissRegular />}
                disabled={currentContext.commands.disableDeleteDocument}
                onClick={onDeleteClick}
            />
        </Toolbar>
    );
};

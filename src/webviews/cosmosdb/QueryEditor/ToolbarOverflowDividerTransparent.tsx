/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ToolbarOverflowDividerTransparentProps = {
    padding?: string | number;
};

export const ToolbarOverflowDividerTransparent = (props: ToolbarOverflowDividerTransparentProps) => {
    const padding = props.padding
        ? /^\d+$/.test(`${props.padding}`)
            ? `${props.padding}px`
            : `${props.padding}`
        : '4px'; // Default padding if not provided

    return <div style={{ padding }} />;
};

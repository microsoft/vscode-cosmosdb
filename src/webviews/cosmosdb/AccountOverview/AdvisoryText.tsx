/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { parseAdvisoryText } from '../../../panels/accountOverview/advisoryText';

const useStyles = makeStyles({
    value: {
        fontWeight: tokens.fontWeightBold,
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground1,
        borderRadius: tokens.borderRadiusSmall,
        padding: `0 ${tokens.spacingHorizontalXXS}`,
        boxDecorationBreak: 'clone',
        overflowWrap: 'anywhere',
        '@media (forced-colors: active)': {
            outline: '1px solid CanvasText',
        },
    },
});

export const AdvisoryText = ({ text }: { text: string }) => {
    const styles = useStyles();
    return parseAdvisoryText(text).map((part, index) =>
        part.highlighted ? (
            <span key={index} className={styles.value}>
                {part.text}
            </span>
        ) : (
            part.text
        ),
    );
};

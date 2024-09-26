/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Skeleton, SkeletonItem, type SkeletonProps } from '@fluentui/react-components';

export const LoadingAnimationTable = (props: Partial<SkeletonProps>) => {
    return (
        <div className="loadingAnimationTable">
            <Skeleton {...props} appearance="translucent" aria-label="Loading Content">
                <div className="headerRow">
                    <SkeletonItem size={24} />
                </div>
                <div className="dataGrid">
                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />

                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />

                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />
                    <SkeletonItem size={24} />
                </div>
            </Skeleton>
        </div>
    );
};

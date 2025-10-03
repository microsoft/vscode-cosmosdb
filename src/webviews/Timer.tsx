/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TimerProps = {
    time: number; // time in milliseconds
};

export const Timer = (props: TimerProps) => {
    return (
        <div className="timer">
            <span className="digits">{('0' + Math.floor((props.time / 60000) % 60)).slice(-2)}:</span>
            <span className="digits">{('0' + Math.floor((props.time / 1000) % 60)).slice(-2)}.</span>
            <span className="digits mili-sec">{('0' + Math.floor((props.time / 10) % 100)).slice(-2)}</span>
        </div>
    );
};

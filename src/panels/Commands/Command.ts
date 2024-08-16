import { type Channel } from '../Communication/Channel/Channel';

export type SuccessResult<T> = {
    isSuccess: true;
    value: T;
};

export type ErrorResult = {
    isSuccess: false;
    value: Error;
};

export type CommandResult<T = never> = (SuccessResult<T> | ErrorResult) & Record<string, unknown>;

export interface Command<ResultType = unknown> {
    execute(channel: Channel): Promise<ResultType>;
}


export interface Config {
    apiToken: string
    trigger:
    | 'SDK'
    | 'CLI'
    | 'GITHUB_ACTION'
    | 'GITLAB_CI'
    | 'JENKINS'
    | 'CICD'
    | 'MANUAL'
}

export type TestRunStatus = 'Pending' | 'Running' | 'Finished';
export type TestRunResult = 'Pending' | 'Passed' | 'Failed' | 'Skipped';

export type TestStartResponse = {
    success: boolean;
    message: string;
} & {
    id: string;
    result: string;
    target: string;
}

export type TestWaitResponse = {
    success: boolean;
    message: string;
} & {
    testRun: {
        status: TestRunStatus;
        result: TestRunResult;
    }
}

export interface StartConfig {
    testSuiteID: string
    testSuiteEnvironmentURL: string
}

export interface WaitConfig {
    testSuiteRunID: string
}

export interface IClient {
    start(config: StartConfig): Promise<{ name: string; url: string; runID: string }>
    wait(config: WaitConfig): Promise<{ result?: TestRunResult }>
}

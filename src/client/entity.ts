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

export type TestRunStatus = 'Pending' | 'Running' | 'Finished'
export type TestRunResult = 'Pending' | 'Passed' | 'Failed' | 'Skipped'

export interface TestRun {
  id: number
  status: TestRunStatus
  result: TestRunResult
  duration: string
  failedTestCaseCount: number
  passedTestCaseCount: number
  totalTestCaseCount: number
  createdAt: string
  startTime: string
  endTime: string
}

export interface TestCaseResult {
  id: number
  testCaseId: number
  testRunId: number
  result: TestRunResult
  summary?: string
  startTime?: string
  endTime?: string
  report?: Array<{
    resultJson?: Record<
      string,
      {
        status?: string
        message?: string
        description?: string
      }
    >
  }>
}

export type TestStartResponse = {
  success: boolean
  message: string
} & {
  id: number
  result: string
  target: string
}

export type TestWaitResponse = {
  success: boolean
  message: string
} & {
  testRun: TestRun
}

export interface DetailedTestRunResponse {
  success: boolean
  message?: string
  testRun: TestRun
  testCaseResults?: TestCaseResult[]
}

export interface StartConfig {
  testSuiteID: string
  environmentID: number | undefined
  environmentURL?: string
}

export interface WaitConfig {
  testSuiteRunID: number
  timeout?: number
}

export interface IClient {
  start(
    config: StartConfig
  ): Promise<{ name: string; url: string; runID: number }>
  wait(
    config: WaitConfig
  ): Promise<{ result?: TestRunResult; updatedAt?: string }>
}

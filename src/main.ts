import * as core from '@actions/core'
import { context } from '@actions/github'
import { Client } from './client/index.js'
import {
  TestCaseResult,
  TestRun,
  TestRunResult,
  TestSuiteResult
} from './client/entity.js'
import { Github } from './github/github.js'
import { MAX_WAIT_TIME, POLL_INTERVAL } from './client/constants.js'

const timestamp = () =>
  new Date().toISOString().replace('T', ' ').substring(0, 19)

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const normalizeToNumber = (value: string, fieldName: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number, got: ${value}`)
  }
  return parsed
}

const parseTestSuiteIDs = (raw: string): number[] => {
  const parts = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  if (parts.length === 0) {
    throw new Error('At least one test suite ID is required')
  }

  return parts.map((id) => normalizeToNumber(id, 'test-suite-id'))
}

export const parseTestContextInput = (
  input: string
): Record<string, string> | undefined => {
  if (!input) {
    return undefined
  }

  const testContext: Record<string, string> = {}

  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) {
      throw new Error(
        `test-context line must be in KEY=VALUE format, got: "${trimmed}"`
      )
    }

    const key = trimmed.substring(0, eqIndex).trim()
    const value = trimmed.substring(eqIndex + 1).trim()

    if (!key) {
      throw new Error(
        `test-context key must not be empty, got: "${trimmed}"`
      )
    }

    testContext[key] = value
  }

  return Object.keys(testContext).length > 0 ? testContext : undefined
}

const buildGithubMetadata = (
  commitSHAInput: string
): Record<string, unknown> => {
  const pullRequest = context.payload.pull_request
  const commitSHA = commitSHAInput || process.env.GITHUB_SHA || context.sha
  const headCommitMessage = context.payload.head_commit?.message
  const normalizedCommitMessage =
    typeof headCommitMessage === 'string' && headCommitMessage.trim().length > 0
      ? headCommitMessage.trim()
      : undefined
  const commitTitle = normalizedCommitMessage?.split('\n')[0]

  return {
    source: 'github_action',
    repository: process.env.GITHUB_REPOSITORY,
    workflow: process.env.GITHUB_WORKFLOW,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunNumber: process.env.GITHUB_RUN_NUMBER,
    job: process.env.GITHUB_JOB,
    actor: process.env.GITHUB_ACTOR,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: commitSHA,
    pullRequestId: pullRequest?.number ? String(pullRequest.number) : undefined,
    pullRequestTitle: pullRequest?.title,
    pullRequestUrl: pullRequest?.html_url,
    commitName: commitTitle,
    commitTitle,
    commitMessage: normalizedCommitMessage
  }
}

const derivePreflightResult = (
  run: TestRun,
  testCaseResults: TestCaseResult[] | undefined
): TestRunResult | 'Skipped' | 'Pending' => {
  if (!run.preflightTestCaseId) {
    return 'Skipped'
  }

  const preflightResult =
    testCaseResults?.find(
      (item) => item.id === run.preflightTestCaseResultId
    ) ||
    testCaseResults?.find(
      (item) =>
        item.type?.toLowerCase() === 'preflight' ||
        item.testCaseId === run.preflightTestCaseId
    )

  if (!preflightResult?.result) {
    return 'Pending'
  }

  return preflightResult.result
}

const toCommentSuiteRun = (
  runId: number,
  suiteResult: TestSuiteResult | undefined,
  fallbackRun: TestRun,
  forceResult?: TestRunResult
): TestRun => {
  const result = forceResult || suiteResult?.result || fallbackRun.result

  return {
    id: runId,
    status: suiteResult?.status || fallbackRun.status,
    result,
    duration: suiteResult?.duration || '',
    failedTestCaseCount: suiteResult?.failedTestCaseCount ?? 0,
    passedTestCaseCount: suiteResult?.passedTestCaseCount ?? 0,
    totalTestCaseCount: suiteResult?.totalTestCaseCount ?? 0,
    createdAt: fallbackRun.createdAt,
    startTime: suiteResult?.startTime,
    endTime: suiteResult?.endTime,
    preflightTestCaseId: fallbackRun.preflightTestCaseId,
    preflightTestCaseResultId: fallbackRun.preflightTestCaseResultId
  }
}

const buildCommentStateSignature = (params: {
  runStatus: string | undefined
  runResult: string | undefined
  preflightResult: string
  suites: Array<{
    testSuiteID: string
    status?: string
    result?: string
    startTime?: string
    endTime?: string
    failedCount?: number
    passedCount?: number
    totalCount?: number
  }>
}): string =>
  JSON.stringify({
    runStatus: params.runStatus || '',
    runResult: params.runResult || '',
    preflightResult: params.preflightResult,
    suites: params.suites
  })

const logSuiteStates = (params: {
  runStatus?: string
  runResult?: string
  runURL: string
  preflightTestCaseID?: number
  preflightResult?: TestRunResult | 'Skipped' | 'Pending'
  suites: Array<{
    testSuiteID: string
    testSuiteRun: TestRun
  }>
}): void => {
  core.info(
    `[${timestamp()}][shiplight] Run status: ${params.runStatus || 'Unknown'}, result: ${params.runResult || 'Unknown'}, details: ${params.runURL}`
  )

  if (params.preflightTestCaseID) {
    core.info(
      `[${timestamp()}][shiplight] Preflight test: ${params.preflightTestCaseID}, result: ${params.preflightResult || 'Pending'}`
    )
  }

  params.suites.forEach((suite) => {
    const suiteRun = suite.testSuiteRun
    const counts =
      suiteRun.totalTestCaseCount > 0
        ? `, passed: ${suiteRun.passedTestCaseCount}, failed: ${suiteRun.failedTestCaseCount}, total: ${suiteRun.totalTestCaseCount}`
        : ''

    core.info(
      `[${timestamp()}][shiplight] Test suite ${suite.testSuiteID} status: ${suiteRun.status}, result: ${suiteRun.result}${counts}`
    )
  })
}

const logFinalResults = (params: {
  runID: number
  runStatus?: string
  runResult?: string
  runURL: string
  preflightTestCaseID?: number
  preflightResult?: TestRunResult | 'Skipped' | 'Pending'
  results: Array<{
    testSuiteID: string
    name: string
    result: TestRunResult
    url: string
    error: string | null
    suiteResult?: TestSuiteResult
  }>
}): void => {
  if (params.preflightTestCaseID) {
    core.info(
      `[${timestamp()}][shiplight] Preflight test: ${params.preflightTestCaseID}, result: ${params.preflightResult || 'Pending'}`
    )
  }

  params.results.forEach((result) => {
    const counts =
      result.suiteResult?.totalTestCaseCount &&
      result.suiteResult.totalTestCaseCount > 0
        ? `, passed: ${result.suiteResult.passedTestCaseCount ?? 0}, failed: ${result.suiteResult.failedTestCaseCount ?? 0}, total: ${result.suiteResult.totalTestCaseCount}`
        : ''

    core.info(
      `[${timestamp()}][shiplight] Test suite: ${result.name} (${result.testSuiteID})`
    )
    core.info(`[${timestamp()}][shiplight] Result: ${result.result}${counts}`)
    if (result.error) {
      core.info(`[${timestamp()}][shiplight] Error: ${result.error}`)
    }
  })
  core.info(`[${timestamp()}][shiplight] Details: ${params.runURL}`)
}

export async function run(): Promise<void> {
  try {
    core.info(`[${timestamp()}][shiplight] prepare ...`)

    const apiToken: string = core.getInput('api-token')
    const testSuiteIDInput: string = core.getInput('test-suite-id')
    const environmentID: string = core.getInput('environment-id')
    const environmentURL: string = core.getInput('environment-url')
    const githubComment: boolean = core.getInput('github-comment') === 'true'
    const githubToken: string = core.getInput('github-token')
    const asyncMode: boolean = core.getInput('async') === 'true'
    const commitSHAInput: string = core.getInput('commit-sha')
    const timeoutSecondsInput: string = core.getInput('timeout-seconds')
    const preflightTestCaseIdInput: string = core.getInput(
      'preflight-test-case-id'
    )
    const testContextInput: string = core.getInput('test-context')

    const timeoutSeconds: number = timeoutSecondsInput
      ? parseInt(timeoutSecondsInput, 10)
      : MAX_WAIT_TIME / 1000
    const timeout: number = timeoutSeconds * 1000

    const trimmedApiToken = apiToken.trim()
    if (!trimmedApiToken) {
      throw new Error('API token is required but was not provided')
    }
    if (trimmedApiToken.length < 10) {
      throw new Error('API token appears to be invalid (too short)')
    }

    const testSuiteIDs = parseTestSuiteIDs(testSuiteIDInput)

    const environmentIDNumber = environmentID
      ? normalizeToNumber(environmentID, 'environment-id')
      : undefined

    const preflightTestCaseID = preflightTestCaseIdInput
      ? normalizeToNumber(preflightTestCaseIdInput, 'preflight-test-case-id')
      : undefined

    const testContext = parseTestContextInput(testContextInput)
    if (testContext) {
      core.info(`testContext: ${JSON.stringify(testContext)}`)
    }

    const metadata = buildGithubMetadata(commitSHAInput)
    const commitSHA =
      commitSHAInput || (typeof metadata.sha === 'string' ? metadata.sha : '')

    const environmentIDSafe = environmentID || 'default-env'
    const runIdentifier = `${environmentIDSafe}-${testSuiteIDs.join('_')}`

    core.info(`testSuiteIds: ${JSON.stringify(testSuiteIDs)}`)
    core.info(`testSuiteEnvironmentURL: ${environmentURL}`)
    core.info(`githubComment: ${githubComment}`)
    core.info(`async: ${asyncMode}`)
    core.info(`timeoutSeconds: ${timeoutSeconds}`)
    core.info(`preflightTestCaseID: ${preflightTestCaseID ?? 'none'}`)
    core.info(`testContext: ${JSON.stringify(testContext)}`)

    const client = new Client({
      apiToken: trimmedApiToken,
      trigger: 'GITHUB_ACTION'
    })

    const github = new Github({ token: githubToken })

    core.info(`[${timestamp()}][shiplight] starting single test run ...`)
    const startedRun = await client.startBatch({
      testSuiteIDs,
      environmentID: environmentIDNumber,
      environmentURL,
      preflightTestCaseID,
      metadata,
      testContext
    })
    core.info(
      `[${timestamp()}][shiplight] Started run ${startedRun.runID}, details: ${startedRun.url}`
    )

    core.setOutput('run-id', startedRun.runID)
    core.setOutput('run-url', startedRun.url)
    core.setOutput('metadata', JSON.stringify(metadata))

    if (asyncMode) {
      core.info(
        `[${timestamp()}][shiplight] async mode is enabled, skip waiting and commenting`
      )
      core.setOutput('success', true)
      core.setOutput(
        'results',
        JSON.stringify(
          testSuiteIDs.map((suiteID) => ({
            testSuiteID: String(suiteID),
            name: `Test Suite ${suiteID}`,
            result: 'Pending',
            url: startedRun.url,
            error: null
          }))
        )
      )
      core.setOutput(
        'preflight-result',
        preflightTestCaseID !== undefined ? 'Pending' : 'Skipped'
      )
      return
    }

    const initialCommentSuites = testSuiteIDs.map((suiteID) => ({
      testSuiteID: String(suiteID),
      testSuiteName: `Test Suite ${suiteID}`,
      testSuiteRun: toCommentSuiteRun(startedRun.runID, undefined, {
        id: startedRun.runID,
        status: 'Pending',
        result: 'Pending',
        duration: '',
        failedTestCaseCount: 0,
        passedTestCaseCount: 0,
        totalTestCaseCount: 0,
        createdAt: new Date().toISOString(),
        startTime: undefined,
        endTime: undefined,
        preflightTestCaseId: preflightTestCaseID,
        preflightTestCaseResultId: undefined
      })
    }))
    let lastCommentSignature = buildCommentStateSignature({
      runStatus: 'Pending',
      runResult: 'Pending',
      preflightResult:
        preflightTestCaseID !== undefined ? 'Pending' : 'Skipped',
      suites: initialCommentSuites.map((suite) => ({
        testSuiteID: suite.testSuiteID,
        status: suite.testSuiteRun.status,
        result: suite.testSuiteRun.result,
        startTime: suite.testSuiteRun.startTime,
        endTime: suite.testSuiteRun.endTime,
        failedCount: suite.testSuiteRun.failedTestCaseCount,
        passedCount: suite.testSuiteRun.passedTestCaseCount,
        totalCount: suite.testSuiteRun.totalTestCaseCount
      }))
    })

    if (githubComment) {
      try {
        await github.comment({
          identifier: runIdentifier,
          commitSHA,
          preflightResult:
            preflightTestCaseID !== undefined ? 'Pending' : 'Skipped',
          preflightTestCaseId: preflightTestCaseID,
          testSuites: initialCommentSuites
        })
      } catch (error: unknown) {
        core.warning(
          `Failed to comment on pull request: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    core.info(
      `[${timestamp()}][shiplight] polling test run and updating comment on state changes ...`
    )
    const pollingStartTime = Date.now()
    let lastDetailedRun = await client.getDetailedResults(startedRun.runID)

    while (true) {
      if (Date.now() - pollingStartTime > timeout) {
        core.setOutput('success', false)
        core.setOutput(
          'preflight-result',
          preflightTestCaseID ? 'Pending' : 'Skipped'
        )
        core.setOutput(
          'results',
          JSON.stringify(
            testSuiteIDs.map((suiteID) => ({
              testSuiteID: String(suiteID),
              name: `Test Suite ${suiteID}`,
              result: 'Failed',
              url: startedRun.url,
              error: `Timeout after ${timeoutSeconds} seconds`
            }))
          )
        )
        core.setFailed(`Test run timed out after ${timeoutSeconds} seconds`)
        return
      }

      const testRun = lastDetailedRun.testRun
      const testSuiteResults = lastDetailedRun.testSuiteResults || []
      const testCaseResults = lastDetailedRun.testCaseResults || []

      const suiteResultMap = new Map<number, TestSuiteResult>()
      for (const suiteResult of testSuiteResults) {
        if (suiteResult.testSuiteId !== undefined) {
          suiteResultMap.set(suiteResult.testSuiteId, suiteResult)
        }
      }

      const finalResults = testSuiteIDs.map((suiteID) => {
        const suiteResult = suiteResultMap.get(suiteID)
        const result: TestRunResult =
          (suiteResult?.result as TestRunResult) || testRun.result || 'Failed'
        return {
          testSuiteID: String(suiteID),
          name: `Test Suite ${suiteID}`,
          url: startedRun.url,
          result,
          error: null as string | null,
          suiteResult
        }
      })

      const preflightResult = derivePreflightResult(testRun, testCaseResults)
      core.setOutput('preflight-result', preflightResult)

      const commentSuites = finalResults.map((finalResult) => {
        const suiteResultId = finalResult.suiteResult?.id
        const suiteTestCaseResults = suiteResultId
          ? testCaseResults.filter(
              (testCaseResult) =>
                testCaseResult.testSuiteResultId === suiteResultId &&
                testCaseResult.result === 'Failed'
            )
          : []

        return {
          testSuiteID: finalResult.testSuiteID,
          testSuiteName: finalResult.name,
          testSuiteRun: toCommentSuiteRun(
            startedRun.runID,
            finalResult.suiteResult,
            testRun,
            finalResult.result
          ),
          testCaseResults: suiteTestCaseResults
        }
      })

      const currentCommentSignature = buildCommentStateSignature({
        runStatus: testRun.status,
        runResult: testRun.result,
        preflightResult,
        suites: commentSuites.map((suite) => ({
          testSuiteID: suite.testSuiteID,
          status: suite.testSuiteRun.status,
          result: suite.testSuiteRun.result,
          startTime: suite.testSuiteRun.startTime,
          endTime: suite.testSuiteRun.endTime,
          failedCount: suite.testSuiteRun.failedTestCaseCount,
          passedCount: suite.testSuiteRun.passedTestCaseCount,
          totalCount: suite.testSuiteRun.totalTestCaseCount
        }))
      })

      if (currentCommentSignature !== lastCommentSignature) {
        logSuiteStates({
          runStatus: testRun.status,
          runResult: testRun.result,
          runURL: startedRun.url,
          preflightTestCaseID: testRun.preflightTestCaseId,
          preflightResult,
          suites: commentSuites.map((suite) => ({
            testSuiteID: suite.testSuiteID,
            testSuiteRun: suite.testSuiteRun
          }))
        })
      }

      if (githubComment && currentCommentSignature !== lastCommentSignature) {
        try {
          await github.comment({
            identifier: runIdentifier,
            commitSHA,
            preflightResult,
            preflightTestCaseId: testRun.preflightTestCaseId,
            testSuites: commentSuites
          })
          lastCommentSignature = currentCommentSignature
        } catch (error: unknown) {
          core.warning(
            `Failed to update comment on pull request: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      if (testRun.status === 'Finished') {
        const failedResults = finalResults.filter(
          (result) => result.result === 'Failed'
        )
        const allSuccessful = failedResults.length === 0
        logFinalResults({
          runID: startedRun.runID,
          runStatus: testRun.status,
          runResult: testRun.result,
          runURL: startedRun.url,
          preflightTestCaseID: testRun.preflightTestCaseId,
          preflightResult,
          results: finalResults
        })

        core.setOutput('success', allSuccessful)
        core.setOutput(
          'results',
          JSON.stringify(
            finalResults.map((result) => ({
              testSuiteID: result.testSuiteID,
              name: result.name,
              result: result.result,
              url: result.url,
              error: result.error
            }))
          )
        )

        if (!allSuccessful) {
          core.setFailed(
            `${failedResults.length} out of ${finalResults.length} test suites failed in run ${startedRun.runID}`
          )
        }
        return
      }

      await delay(POLL_INTERVAL)
      try {
        lastDetailedRun = await client.getDetailedResults(startedRun.runID)
      } catch (error: unknown) {
        core.warning(
          `Polling run details failed (will retry): ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setOutput('success', false)
      core.setFailed(error.message)
      return
    }

    core.setOutput('success', false)
    core.setFailed(String(error))
  }
}

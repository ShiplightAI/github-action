import * as core from '@actions/core'
import { doreamon } from '@zodash/doreamon'
import { Client } from './client/index.js'
import { Github } from './github/github.js'
import { MAX_WAIT_TIME } from './client/constants.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // process.env['INPUT_API-TOKEN'] = process.env.API_TOKEN || ''
    // process.env['INPUT_TEST-SUITE-ID'] = process.env.TEST_SUITE_ID || ''
    // process.env['INPUT_ENVIRONMENT-URL'] = process.env.TEST_SUITE_ENVIRONMENT_URL || ''

    // S1. prepare
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] prepare ...`
    )
    const apiToken: string = core.getInput('api-token')
    const testSuiteIDInput: string = core.getInput('test-suite-id')
    const environmentID: string = core.getInput('environment-id')
    const environmentURL: string = core.getInput('environment-url')
    const githubComment: boolean = core.getInput('github-comment') === 'true'
    const githubToken: string = core.getInput('github-token')
    const async: boolean = core.getInput('async') === 'true'
    const commitSHA: string = core.getInput('commit-sha')
    const timeoutSecondsInput: string = core.getInput('timeout-seconds')
    const timeoutSeconds: number = timeoutSecondsInput
      ? parseInt(timeoutSecondsInput, 10)
      : MAX_WAIT_TIME / 1000
    const timeout: number = timeoutSeconds * 1000

    // Generate unique identifier based on environment and test suites
    const environmentIDSafe = environmentID || 'default-env'
    const testSuiteIDSafe = testSuiteIDInput
      .replace(/[^a-zA-Z0-9,-]/g, '')
      .replace(/,/g, '_')
    const runIdentifier = `${environmentIDSafe}-${testSuiteIDSafe}`

    // Parse test suite IDs (supports single ID or comma-separated list for backward compatibility)
    const testSuiteIDs = testSuiteIDInput
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)

    let environmentIDNumber: number | undefined = undefined
    if (!isNaN(+environmentID)) {
      environmentIDNumber = +environmentID
    }

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.info(`apiToken: ${apiToken}`)
    core.info(`testSuiteIds: ${JSON.stringify(testSuiteIDs)}`)
    core.info(`testSuiteEnvironmentURL: ${environmentURL}`)
    core.info(`githubComment: ${githubComment}`)
    core.info(`githubToken: ${githubToken}`)
    core.info(`async: ${async}`)
    core.info(`timeoutSeconds: ${timeoutSeconds}`)
    core.info(`timeout: ${timeout}`)
    core.info(`environmentID: ${environmentID} -> safe: ${environmentIDSafe}`)
    core.info(
      `testSuiteIDInput: ${testSuiteIDInput} -> safe: ${testSuiteIDSafe}`
    )
    core.info(
      `runIdentifier: ${runIdentifier} (environmentID-testSuiteIDInput)`
    )

    if (testSuiteIDs.length === 0) {
      throw new Error('At least one test suite ID is required')
    }

    // client
    const client = new Client({
      apiToken,
      trigger: 'GITHUB_ACTION'
    })
    // github
    const github = new Github({
      token: githubToken
    })

    // S2. start all test runs in parallel
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] starting ${testSuiteIDs.length} test runs in parallel ...`
    )

    const testRunPromises = testSuiteIDs.map(async (testSuiteID) => {
      try {
        const { name, url, runID } = await client.start({
          testSuiteID,
          environmentID: environmentIDNumber,
          environmentURL
        })
        return {
          testSuiteID,
          name,
          url,
          runID,
          error: null
        }
      } catch (error: any) {
        core.warning(
          `Failed to start test suite ${testSuiteID}: ${error.message}`
        )
        return {
          testSuiteID,
          name: `Test Suite ${testSuiteID}`,
          url: '',
          runID: 0,
          error: error.message
        }
      }
    })

    const testRuns = await Promise.all(testRunPromises)

    // S2.1 if async is true, return
    if (async) {
      core.info(
        `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] async mode is enabled, ignore wait for the test runs to finish and no comment on the pull request`
      )
      return
    }

    // S3. comment on the pull request with initial pending status
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] posting initial comment on the pull request ...`
    )
    if (githubComment) {
      try {
        const testSuites = testRuns.map((testRun) => ({
          testSuiteID: testRun.testSuiteID,
          testSuiteName: testRun.name,
          testSuiteRun:
            testRun.error || testRun.runID === 0
              ? ({
                  id: '',
                  result: 'Failed',
                  startTime: new Date().toISOString(),
                  endTime: new Date().toISOString()
                } as any)
              : ({
                  id: testRun.runID,
                  result: 'Pending'
                } as any)
        }))

        await github.comment({
          identifier: runIdentifier,
          commitSHA,
          testSuites
        })
      } catch (error: any) {
        core.warning(`Failed to comment on pull request: ${error.message}`)
      }
    }

    // S3.1 wait for all test runs to finish in parallel
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] waiting for all test runs to finish ...`
    )

    const waitPromises = testRuns.map(async (testRun) => {
      if (testRun.error || testRun.runID === 0) {
        return {
          testSuiteID: testRun.testSuiteID,
          name: testRun.name,
          url: testRun.url,
          result: {
            result: 'Failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          } as any,
          error: testRun.error
        }
      }

      try {
        const result = await client.wait({
          testSuiteRunID: testRun.runID,
          timeout
        })
        return {
          testSuiteID: testRun.testSuiteID,
          name: testRun.name,
          url: testRun.url,
          result,
          error: null
        }
      } catch (error: any) {
        core.warning(
          `Failed to wait for test suite ${testRun.testSuiteID}: ${error.message}`
        )
        return {
          testSuiteID: testRun.testSuiteID,
          name: testRun.name,
          url: testRun.url,
          result: {
            result: 'Failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          } as any,
          error: error.message
        }
      }
    })

    const finalResults = await Promise.all(waitPromises)

    // S3.2 update comment with final results
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] updating comment with final results ...`
    )
    if (githubComment) {
      try {
        const testSuites = finalResults.map((finalResult) => ({
          testSuiteID: finalResult.testSuiteID,
          testSuiteName: finalResult.name,
          testSuiteRun: finalResult.result
        }))

        await github.comment({
          identifier: runIdentifier,
          commitSHA,
          testSuites
        })
      } catch (error: any) {
        core.warning(
          `Failed to update comment on pull request: ${error.message}`
        )
      }
    }

    // Log results for each test suite
    finalResults.forEach((finalResult) => {
      core.info(
        `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] Test suite: ${finalResult.name} (${finalResult.testSuiteID})`
      )
      core.info(
        `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] Result: ${finalResult.result.result}`
      )
      core.info(
        `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] Details: ${finalResult.url}`
      )
      if (finalResult.error) {
        core.info(
          `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] Error: ${finalResult.error}`
        )
      }
    })

    // Determine overall success
    const failedResults = finalResults.filter(
      (result) => result.result.result === 'Failed'
    )
    const allSuccessful = failedResults.length === 0

    // Set outputs
    core.setOutput('success', allSuccessful)
    core.setOutput(
      'results',
      JSON.stringify(
        finalResults.map((result) => ({
          testSuiteID: result.testSuiteID,
          name: result.name,
          result: result.result.result,
          url: result.url,
          error: result.error
        }))
      )
    )

    if (!allSuccessful) {
      core.setFailed(
        `${failedResults.length} out of ${finalResults.length} test runs failed`
      )
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setOutput('success', false)
      core.setFailed(error.message)
    }
  }
}

import * as core from '@actions/core'
import { Client } from './client/index.js'
import { Github } from './github/github.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // process.env['INPUT_API-TOKEN'] = process.env.API_TOKEN || ''
    // process.env['INPUT_TEST-SUITE-ID'] = process.env.TEST_SUITE_ID || ''
    // process.env['INPUT_TEST-SUITE-ENVIRONMENT-URL'] = process.env.TEST_SUITE_ENVIRONMENT_URL || ''

    // S1. prepare
    const apiToken: string = core.getInput('api-token')
    const testSuiteID: string = core.getInput('test-suite-id')
    const testSuiteEnvironmentURL: string = core.getInput(
      'test-suite-environment-url'
    )
    const githubComment: boolean = core.getInput('github-comment') === 'true'
    const githubToken: string = core.getInput('github-token')
    const async: boolean = core.getInput('async') === 'true'

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug(`apiToken: ${apiToken}`)
    core.debug(`testSuiteId: ${testSuiteID}`)
    core.debug(`testSuiteEnvironmentURL: ${testSuiteEnvironmentURL}`)
    core.debug(`githubComment: ${githubComment}`)
    core.debug(`githubToken: ${githubToken}`)
    core.debug(`async: ${async}`)

    // client
    const client = new Client({
      apiToken,
      trigger: 'GITHUB_ACTION'
    })
    // github
    const github = new Github({
      token: githubToken
    })

    // S2. start the test run
    const { name, url, runID } = await client.start({
      testSuiteID,
      testSuiteEnvironmentURL
    })

    // S2.1 if async is true, return
    if (async) {
      return
    }

    // S3. comment on the pull request
    if (githubComment) {
      await github.comment({
        testSuiteID: testSuiteID,
        testSuiteName: name,
        testSuiteRun: {
          id: runID,
          result: 'Pending'
        } as any
      })
    }

    // S3.1 wait for the test run to finish
    const runResult = await client.wait({
      testSuiteRunID: runID
    })

    // S3.2 comment on the pull request
    if (githubComment) {
      await github.comment({
        testSuiteID: testSuiteID,
        testSuiteName: name,
        testSuiteRun: runResult
      })
    }

    core.info(`Test suite name: ${name}`)
    core.info(`Test run result: ${runResult.result}`)
    core.info(`Test run details: ${url}`)

    core.setOutput('success', true)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setOutput('success', false)
      core.setFailed(error.message)
    }
  }
}

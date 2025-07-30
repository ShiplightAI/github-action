import * as core from '@actions/core'
import { doreamon } from '@zodash/doreamon'
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
    // process.env['INPUT_ENVIRONMENT-URL'] = process.env.TEST_SUITE_ENVIRONMENT_URL || ''

    // S1. prepare
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] prepare ...`
    )
    const apiToken: string = core.getInput('api-token')
    const testSuiteID: string = core.getInput('test-suite-id')
    const environmentID: string = core.getInput('environment-id')
    const environmentURL: string = core.getInput('environment-url')
    const githubComment: boolean = core.getInput('github-comment') === 'true'
    const githubToken: string = core.getInput('github-token')
    const async: boolean = core.getInput('async') === 'true'
    const commitSHA: string = core.getInput('commit-sha')

    let environmentIDNumber: number | undefined = undefined
    if (!isNaN(+environmentID)) {
      environmentIDNumber = +environmentID
    }

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug(`apiToken: ${apiToken}`)
    core.debug(`testSuiteId: ${testSuiteID}`)
    core.debug(`environmentID: ${environmentID}`)
    core.debug(`testSuiteEnvironmentURL: ${environmentURL}`)
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
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] start the test run ...`
    )
    const { name, url, runID } = await client.start({
      testSuiteID,
      environmentID: environmentIDNumber,
      environmentURL
    })

    // S2.1 if async is true, return
    if (async) {
      core.info(
        `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] async mode is enabled, ignore wait for the test run to finish and no comment on the pull request`
      )
      return
    }

    // S3. comment on the pull request
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] comment start on the pull request ...`
    )
    if (githubComment) {
      try {
        await github.comment({
          commitSHA,
          testSuiteID: testSuiteID,
          testSuiteName: name,
          testSuiteRun: {
            id: runID,
            result: 'Pending'
          } as any
        })
      } catch (error: any) {
        core.warning(`Failed to comment on the pull request: ${error.message}`)
      }
    }

    // S3.1 wait for the test run to finish
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] wait for the test run to finish ...`
    )
    const runResult = await client.wait({
      testSuiteRunID: runID
    })

    // S3.2 comment on the pull request
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] comment finishedon the pull request ...`
    )
    if (githubComment) {
      try {
        await github.comment({
          commitSHA,
          testSuiteID: testSuiteID,
          testSuiteName: name,
          testSuiteRun: runResult
        })
      } catch (error: any) {
        core.warning(`Failed to comment on the pull request: ${error.message}`)
      }
    }

    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] Test suite name: ${name}`
    )
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] Test run result: ${runResult.result}`
    )
    core.info(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][shiplight] Test run details: ${url}`
    )

    if (runResult.result === 'Failed') {
      core.setFailed(
        'Test run failed because of the test suite result is Failed'
      )
      core.setOutput('success', false)
    } else {
      core.setOutput('success', true)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setOutput('success', false)
      core.setFailed(error.message)
    }
  }
}

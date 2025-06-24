import * as core from '@actions/core'
import { Client } from './client/index.js'

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

    const apiToken: string = core.getInput('api-token')
    const testSuiteId: string = core.getInput('test-suite-id')
    const testSuiteEnvironmentURL: string = core.getInput(
      'test-suite-environment-url'
    )

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug(`apiToken: ${apiToken}`)
    core.debug(`testSuiteId: ${testSuiteId}`)
    core.debug(`testSuiteEnvironmentURL: ${testSuiteEnvironmentURL}`)

    // client
    const client = new Client({
      apiToken,
      trigger: 'GITHUB_ACTION'
    })
    const { url } = await client.run({ testSuiteId, testSuiteEnvironmentURL })

    core.info(`Test run results: ${url}`)

    core.setOutput('url', url)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

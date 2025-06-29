import core from '@actions/core'
import { doreamon } from '@zodash/doreamon'
import { APP_URL, API_URL, MAX_WAIT_TIME, POLL_INTERVAL } from './constants.js'
import {
  Config,
  IClient,
  StartConfig,
  TestRunResult,
  TestStartResponse,
  TestWaitResponse,
  WaitConfig
} from './entity.js'

export class Client implements IClient {
  private config: Config

  constructor(config: Config) {
    this.config = config

    if (!this.config.apiToken) {
      throw new Error('API token is required')
    }
  }

  async start(config: StartConfig) {
    const { testSuiteID: testSuiteId, testSuiteEnvironmentURL } = config
    if (!testSuiteId) {
      throw new Error('Test suite ID is required')
    }
    if (!testSuiteEnvironmentURL) {
      throw new Error('Test suite environment URL is required')
    }

    const url = `${API_URL}/v1/test-run/test-suite/${testSuiteId}`

    const response = await doreamon.request
      .post(url, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiToken}`
        },
        body: {
          environment: {
            url: testSuiteEnvironmentURL
          },
          testContext: {},
          trigger: this.config.trigger
        }
      })
      .json<TestStartResponse>()

    core.debug(
      '[debug] client.start response: ' + JSON.stringify(response, null, 2)
    )

    if (response?.success === false) {
      throw new Error(response?.message)
    }

    return {
      name: response?.target!,
      url: `${APP_URL}/run-results/${response?.id!}`,
      runID: response?.id!
    }
  }

  async wait(config: WaitConfig) {
    const { testSuiteRunID: testRunId } = config
    if (!testRunId) {
      throw new Error('Test run ID is required')
    }

    const url = `${API_URL}/run-results/${testRunId}`
    const startTime = Date.now()

    while (true) {
      if (Date.now() - startTime > MAX_WAIT_TIME) {
        return {
          result: 'Timeout' as TestRunResult
        } as any
      }

      const response = await doreamon.request
        .get(url, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiToken}`
          }
        })
        .json<TestWaitResponse>()

      core.debug(
        '[debug] client.wait response: ' + JSON.stringify(response, null, 2)
      )

      if (response?.success === false) {
        throw new Error(response?.message)
      }

      if (response?.testRun?.status === 'Finished') {
        return response?.testRun
      }

      await doreamon.delay(POLL_INTERVAL)
    }
  }
}

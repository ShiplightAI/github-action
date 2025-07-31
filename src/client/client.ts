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
    const { testSuiteID: testSuiteId, environmentID, environmentURL } = config
    if (!testSuiteId) {
      throw new Error('Test suite id is required')
    }
    // if (!environmentID) {
    //   throw new Error('Test suite environment id is required')
    // }

    const url = `${API_URL}/v1/test-run/test-suite/${testSuiteId}`

    core.debug(
      '[client.start] request: ' +
        JSON.stringify(
          {
            method: 'POST',
            url,
            body: {
              environment: {
                id: environmentID,
                url: environmentURL
              },
              testContext: {},
              trigger: this.config.trigger
            }
          },
          null,
          2
        )
    )

    const response = await doreamon.request
      .post(url, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiToken}`
        },
        body: {
          environment: {
            id: environmentID,
            url: environmentURL
          },
          testContext: {},
          trigger: this.config.trigger
        }
      })
      .json<TestStartResponse>()

    core.debug(
      `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][client.start] response: ` +
        JSON.stringify(response, null, 2)
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
    const { testSuiteRunID: testRunId, timeout = MAX_WAIT_TIME } = config
    if (!testRunId) {
      throw new Error('Test run ID is required')
    }

    const url = `${API_URL}/run-results/${testRunId}`
    const startTime = Date.now()

    while (true) {
      if (Date.now() - startTime > timeout) {
        return {
          result: 'Timeout' as TestRunResult
        } as any
      }

      core.debug(
        `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][client.wait] request: ` +
          JSON.stringify(
            {
              method: 'GET',
              url,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.apiToken}`
              }
            },
            null,
            2
          )
      )

      const response = await doreamon.request
        .get(url, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiToken}`
          }
        })
        .json<TestWaitResponse>()

      core.debug(
        `[${doreamon.date().format('YYYY-MM-DD HH:mm:ss')}][client.wait] response: ` +
          JSON.stringify(response, null, 2)
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

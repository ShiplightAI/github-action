import * as core from '@actions/core'
import { APP_URL, API_URL, MAX_WAIT_TIME, POLL_INTERVAL } from './constants.js'
import {
  BatchStartConfig,
  Config,
  DetailedTestRunResponse,
  IClient,
  StartConfig,
  TestRunResult,
  TestStartResponse,
  TestWaitResponse,
  WaitConfig
} from './entity.js'

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const timestamp = () =>
  new Date().toISOString().replace('T', ' ').substring(0, 19)

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      core.debug(
        `[${timestamp()}][fetch] Attempt ${attempt}/${maxRetries} for ${url}`
      )
      return await fetch(url, options)
    } catch (error) {
      lastError = error as Error
      core.debug(
        `[${timestamp()}][fetch] Attempt ${attempt} failed: ${lastError.message}`
      )

      if (attempt < maxRetries) {
        const waitTime = retryDelay * Math.pow(2, attempt - 1)
        core.debug(
          `[${timestamp()}][fetch] Waiting ${waitTime}ms before retry...`
        )
        await delay(waitTime)
      }
    }
  }

  throw new Error(
    `Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
  )
}

export class Client implements IClient {
  private config: Config

  constructor(config: Config) {
    this.config = config

    if (!this.config.apiToken) {
      throw new Error('API token is required')
    }

    const trimmedToken = this.config.apiToken.trim()
    if (trimmedToken.length < 10) {
      throw new Error('API token appears to be invalid (too short)')
    }

    this.config.apiToken = trimmedToken
  }

  private async requestStart(
    url: string,
    body: Record<string, unknown>,
    errorContext: string
  ): Promise<{ name: string; url: string; runID: number }> {
    core.debug(
      '[client.requestStart] request: ' +
        JSON.stringify(
          {
            method: 'POST',
            url,
            body,
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ***'
            }
          },
          null,
          2
        )
    )

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiToken}`
      },
      body: JSON.stringify(body)
    })

    if (response.status === 401) {
      throw new Error(
        'Authentication failed: Invalid API token or token expired'
      )
    }

    if (response.status === 403) {
      throw new Error(
        'Authorization failed: Token does not have permission to access this resource'
      )
    }

    if (response.status === 404) {
      throw new Error(`${errorContext} not found`)
    }

    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later')
    }

    if (response.status >= 500) {
      throw new Error(
        `Server error (${response.status}): The Shiplight API is experiencing issues`
      )
    }

    let data: TestStartResponse
    try {
      const text = await response.text()
      if (!text) {
        throw new Error('Empty response body')
      }
      data = JSON.parse(text) as TestStartResponse
    } catch (parseError) {
      core.debug(
        `[${timestamp()}][client.requestStart] Failed to parse response: ${parseError}`
      )
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      throw new Error('Invalid JSON response from API')
    }

    core.debug(
      `[${timestamp()}][client.requestStart] response: ` +
        JSON.stringify(data, null, 2)
    )

    if (data?.success === false) {
      throw new Error(data?.message || 'API request failed')
    }

    if (!data?.id || !data?.target) {
      throw new Error(
        'Invalid response: missing required fields (id or target)'
      )
    }

    return {
      name: data.target,
      url: `${APP_URL}/run-results/${data.id}`,
      runID: data.id
    }
  }

  async start(config: StartConfig) {
    const { testSuiteID: testSuiteId, environmentID, environmentURL } = config
    if (!testSuiteId) {
      throw new Error('Test suite id is required')
    }

    try {
      return await this.requestStart(
        `${API_URL}/v1/test-run/test-suite/${testSuiteId}`,
        {
          environment: {
            id: environmentID,
            url: environmentURL
          },
          testContext: {},
          trigger: this.config.trigger
        },
        `Test suite ${testSuiteId}`
      )
    } catch (error) {
      core.debug(
        `[${timestamp()}][client.start] Error details: ${JSON.stringify(error)}`
      )
      if (error instanceof Error) {
        throw new Error(
          `Failed to start test suite ${testSuiteId}: ${error.message}`
        )
      }
      throw error
    }
  }

  async startBatch(config: BatchStartConfig) {
    const {
      testSuiteIDs,
      environmentID,
      environmentURL,
      preflightTestCaseID,
      metadata,
      testContext
    } = config

    if (!testSuiteIDs || testSuiteIDs.length === 0) {
      throw new Error('At least one test suite id is required')
    }

    const body: Record<string, unknown> = {
      test_suite_ids: testSuiteIDs,
      environment: {
        id: environmentID,
        url: environmentURL
      },
      testContext: testContext ?? {},
      trigger: this.config.trigger
    }

    if (metadata && Object.keys(metadata).length > 0) {
      body.metadata = metadata
    }

    if (preflightTestCaseID !== undefined) {
      body.preflight = {
        testCaseId: preflightTestCaseID
      }
    }

    try {
      return await this.requestStart(
        `${API_URL}/v1/test-run`,
        body,
        'Batch test run'
      )
    } catch (error) {
      core.debug(
        `[${timestamp()}][client.startBatch] Error details: ${JSON.stringify(error)}`
      )
      if (error instanceof Error) {
        throw new Error(`Failed to start batch test run: ${error.message}`)
      }
      throw error
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
        } as const
      }

      core.debug(
        `[${timestamp()}][client.wait] request: ` +
          JSON.stringify(
            {
              method: 'GET',
              url,
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ***'
              }
            },
            null,
            2
          )
      )

      try {
        const response = await fetchWithRetry(
          url,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiToken}`
            }
          },
          2,
          2000
        )

        if (response.status === 401) {
          throw new Error(
            'Authentication failed: Invalid API token or token expired'
          )
        }

        if (response.status === 403) {
          throw new Error(
            'Authorization failed: Token does not have permission to access this resource'
          )
        }

        if (response.status === 404) {
          throw new Error(`Test run not found: ${testRunId}`)
        }

        if (response.status === 429) {
          core.debug(
            `[${timestamp()}][client.wait] Rate limited, waiting 30 seconds...`
          )
          await delay(30000)
          continue
        }

        if (response.status >= 500) {
          core.warning(
            `Server error (${response.status}) while polling, will retry...`
          )
          await delay(POLL_INTERVAL * 2)
          continue
        }

        let data: TestWaitResponse
        try {
          const text = await response.text()
          if (!text) {
            throw new Error('Empty response body')
          }
          data = JSON.parse(text) as TestWaitResponse
        } catch (parseError) {
          core.debug(
            `[${timestamp()}][client.wait] Failed to parse response: ${parseError}`
          )
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          throw new Error('Invalid JSON response from API')
        }

        core.debug(
          `[${timestamp()}][client.wait] response: ` +
            JSON.stringify(data, null, 2)
        )

        if (data?.success === false) {
          throw new Error(data?.message || 'API request failed')
        }

        if (data?.testRun?.status === 'Finished') {
          return data.testRun
        }

        if (data?.testRun?.status) {
          core.debug(
            `[${timestamp()}][client.wait] Test run status: ${data.testRun.status}`
          )
        }
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message.includes('Authentication failed') ||
            error.message.includes('Authorization failed') ||
            error.message.includes('not found')
          ) {
            throw error
          }

          core.warning(`Error while polling (will continue): ${error.message}`)
        }
      }

      await delay(POLL_INTERVAL)
    }
  }

  async getDetailedResults(
    testRunID: number
  ): Promise<DetailedTestRunResponse> {
    if (!testRunID) {
      throw new Error('Test run ID is required')
    }

    const url = `${API_URL}/run-results/${testRunID}`

    try {
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiToken}`
        }
      })

      if (response.status === 401) {
        throw new Error(
          'Authentication failed: Invalid API token or token expired'
        )
      }

      if (response.status === 404) {
        throw new Error(`Test run not found: ${testRunID}`)
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = (await response.json()) as DetailedTestRunResponse

      if (data?.success === false) {
        throw new Error(data?.message || 'API request failed')
      }

      return data
    } catch (error) {
      core.debug(`[${timestamp()}][client.getDetailedResults] Error: ${error}`)
      throw error
    }
  }
}

import * as core from '@actions/core'
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

// Helper function for delays
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// Helper function for timestamps
const timestamp = () =>
  new Date().toISOString().replace('T', ' ').substring(0, 19)

// Helper function to make fetch requests with retry logic
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

      const response = await fetch(url, options)

      // If we get a response (even if it's an error status), return it
      // We'll handle the status code in the calling function
      return response
    } catch (error) {
      lastError = error as Error
      core.debug(
        `[${timestamp()}][fetch] Attempt ${attempt} failed: ${lastError.message}`
      )

      // Don't retry on the last attempt
      if (attempt < maxRetries) {
        const waitTime = retryDelay * Math.pow(2, attempt - 1) // Exponential backoff
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

    // Validate token format
    const trimmedToken = this.config.apiToken.trim()
    if (trimmedToken.length < 10) {
      throw new Error('API token appears to be invalid (too short)')
    }

    // Update config with trimmed token
    this.config.apiToken = trimmedToken
  }

  async start(config: StartConfig) {
    const { testSuiteID: testSuiteId, environmentID, environmentURL } = config
    if (!testSuiteId) {
      throw new Error('Test suite id is required')
    }

    const url = `${API_URL}/v1/test-run/test-suite/${testSuiteId}`
    const body = {
      environment: {
        id: environmentID,
        url: environmentURL
      },
      testContext: {},
      trigger: this.config.trigger
    }

    core.debug(
      '[client.start] request: ' +
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

    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiToken}`
        },
        body: JSON.stringify(body)
      })

      // Check HTTP status
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
        throw new Error(`Test suite not found: ${testSuiteId}`)
      }

      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later')
      }

      if (response.status >= 500) {
        throw new Error(
          `Server error (${response.status}): The Shiplight API is experiencing issues`
        )
      }

      // Try to parse JSON response
      let data: TestStartResponse
      try {
        const text = await response.text()
        if (!text) {
          throw new Error('Empty response body')
        }
        data = JSON.parse(text)
      } catch (parseError) {
        core.debug(
          `[${timestamp()}][client.start] Failed to parse response: ${parseError}`
        )
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        throw new Error('Invalid JSON response from API')
      }

      core.debug(
        `[${timestamp()}][client.start] response: ` +
          JSON.stringify(data, null, 2)
      )

      // Check for API-level errors
      if (data?.success === false) {
        throw new Error(data?.message || 'API request failed')
      }

      // Validate required fields
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
    } catch (error) {
      // Log the full error for debugging
      core.debug(
        `[${timestamp()}][client.start] Error details: ${JSON.stringify(error)}`
      )

      // Re-throw with more context
      if (error instanceof Error) {
        throw new Error(
          `Failed to start test suite ${testSuiteId}: ${error.message}`
        )
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
        } as any
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
        ) // Fewer retries for polling, shorter initial delay

        // Check HTTP status
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
          // For rate limiting during polling, wait longer before next attempt
          core.debug(
            `[${timestamp()}][client.wait] Rate limited, waiting 30 seconds...`
          )
          await delay(30000)
          continue
        }

        if (response.status >= 500) {
          // For server errors during polling, log but continue
          core.warning(
            `Server error (${response.status}) while polling, will retry...`
          )
          await delay(POLL_INTERVAL * 2)
          continue
        }

        // Try to parse JSON response
        let data: TestWaitResponse
        try {
          const text = await response.text()
          if (!text) {
            throw new Error('Empty response body')
          }
          data = JSON.parse(text)
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

        // Check for API-level errors
        if (data?.success === false) {
          throw new Error(data?.message || 'API request failed')
        }

        // Check if test run is finished
        if (data?.testRun?.status === 'Finished') {
          return data.testRun
        }

        // Log current status
        if (data?.testRun?.status) {
          core.debug(
            `[${timestamp()}][client.wait] Test run status: ${data.testRun.status}`
          )
        }
      } catch (error) {
        // For polling, we want to be more resilient to transient errors
        if (error instanceof Error) {
          // These are fatal errors that should stop polling
          if (
            error.message.includes('Authentication failed') ||
            error.message.includes('Authorization failed') ||
            error.message.includes('not found')
          ) {
            throw error
          }

          // Log other errors but continue polling
          core.warning(`Error while polling (will continue): ${error.message}`)
        }
      }

      await delay(POLL_INTERVAL)
    }
  }
}

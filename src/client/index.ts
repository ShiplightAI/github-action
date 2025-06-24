import { doreamon } from '@zodash/doreamon'
import { APP_URL, API_URL } from './constants.js'

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

export interface RunConfig {
  testSuiteId: string
  testSuiteEnvironmentURL: string
}

export interface IClient {
  run(config: RunConfig): Promise<{ url: string }>
}

export class Client implements IClient {
  private config: Config

  constructor(config: Config) {
    this.config = config

    if (!this.config.apiToken) {
      throw new Error('API token is required')
    }
  }

  async run(config: RunConfig): Promise<{ url: string }> {
    const { testSuiteId, testSuiteEnvironmentURL } = config
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
      .json<
        { success: boolean; message: string } & { id: string; result: string }
      >()
    if (response?.success === false) {
      console.log('sss:', JSON.stringify(response, null, 2))
      throw new Error(response?.message)
    }

    return {
      url: `${APP_URL}/run-results/${response?.id}`
    }
  }
}

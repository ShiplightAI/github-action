import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { TestRun, TestCaseResult, TestRunResult } from '../client/entity.js'
import { APP_URL } from '../client/constants.js'

const resultEmoji: Record<string, string> = {
  Pending: '🔄',
  Passed: '✅',
  Failed: '❌',
  Skipped: '⏭️'
}

export interface Config {
  token: string
}

export interface CommentConfig {
  identifier: string
  commitSHA: string
  preflightResult?: TestRunResult | 'Skipped' | 'Pending'
  preflightTestCaseId?: number
  testSuites: Array<{
    testSuiteID: string
    testSuiteName: string
    testSuiteRun: TestRun
    testCaseResults?: TestCaseResult[]
  }>
}

function extractFailureSummary(testCase: TestCaseResult): string {
  if (testCase.summary) {
    return testCase.summary
  }

  if (testCase.report && testCase.report.length > 0) {
    const report = testCase.report[0]
    if (report.resultJson) {
      for (const [stepKey, stepData] of Object.entries(report.resultJson)) {
        if (stepData.status === 'failure' && stepData.message) {
          const stepDesc = stepData.description || stepKey
          return `Step ${stepKey} - "${stepDesc}": ${stepData.message}`
        }
      }
    }
  }

  return 'No details available'
}

export class Github {
  private core: ReturnType<typeof getOctokit>

  constructor(config: Config) {
    this.core = getOctokit(config.token)
  }

  async comment(config: CommentConfig) {
    let issue_number = context.payload.pull_request?.number
    if (!issue_number && config.commitSHA) {
      const { data: pull_requests } =
        await this.core.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: context.repo.owner,
          repo: context.repo.repo,
          commit_sha: config.commitSHA
        })

      const openPRs = pull_requests.filter((pr) => pr.state === 'open')
      if (openPRs.length > 0) {
        issue_number = openPRs[0].number
      }
    }

    core.info(`issue_number: ${issue_number}`)

    if (!issue_number) {
      return
    }

    const commentIdentifier = `<!-- shiplight_tests ${config.identifier} -->`
    const firstRunId = config.testSuites.find((suite) => suite.testSuiteRun?.id)
      ?.testSuiteRun?.id

    const tableRows = config.testSuites
      .map((suite) => {
        const testSuiteURL = `${APP_URL}/test-suites/${suite.testSuiteID}`
        const runId = suite.testSuiteRun?.id
        const hasValidRunId = runId && runId !== 0 && String(runId) !== ''

        core.debug(
          `Suite: ${suite.testSuiteName}, runId: ${runId} (type: ${typeof runId}), hasValidRunId: ${hasValidRunId}`
        )

        const name = `[${suite.testSuiteName}](${testSuiteURL})`

        const passedCount = suite.testSuiteRun?.passedTestCaseCount || 0
        const totalCount = suite.testSuiteRun?.totalTestCaseCount || 0

        let result: string
        if (hasValidRunId) {
          const testSuiteRunResultURL = `${APP_URL}/run-results/${runId}`
          const counts =
            totalCount > 0 ? ` (${passedCount}/${totalCount} passed)` : ''
          result = `${resultEmoji[suite.testSuiteRun?.result] || ''} ${suite.testSuiteRun?.result}${counts} [Inspect](${testSuiteRunResultURL})`
        } else {
          const resultText = suite.testSuiteRun?.result || 'Failed'
          result = `${resultEmoji[resultText] || ''} ${resultText}`
        }

        const startTime = suite.testSuiteRun?.startTime
          ? new Date(suite.testSuiteRun.startTime).toLocaleString('en-US', {
              timeZone: 'UTC'
            })
          : '-'
        const endTime = suite.testSuiteRun?.endTime
          ? new Date(suite.testSuiteRun.endTime).toLocaleString('en-US', {
              timeZone: 'UTC'
            })
          : '-'

        return `| ${name} | ${result} | ${startTime} | ${endTime} |`
      })
      .join('\n')

    const failureSections = config.testSuites
      .filter((suite) => {
        const failedCount = suite.testSuiteRun?.failedTestCaseCount || 0
        return (
          failedCount > 0 &&
          suite.testCaseResults &&
          suite.testCaseResults.length > 0
        )
      })
      .map((suite) => {
        const failedTests = suite.testCaseResults!.filter(
          (tc) => tc.result === 'Failed'
        )

        if (failedTests.length === 0) return null

        const failureList = failedTests
          .map((tc) => {
            const testCaseURL = `${APP_URL}/run-results/${tc.testRunId}/test/${tc.testCaseId}/overview`
            const summary = extractFailureSummary(tc)
            return `- **[Test Case #${tc.testCaseId}](${testCaseURL})**: ${summary}`
          })
          .join('\n')

        return `<details>
<summary><strong>${suite.testSuiteName}</strong> - ${failedTests.length} failed test${failedTests.length > 1 ? 's' : ''}</summary>

${failureList}
</details>`
      })
      .filter(Boolean)
      .join('\n\n')

    const hasPreflight =
      typeof config.preflightTestCaseId === 'number' &&
      Number.isFinite(config.preflightTestCaseId) &&
      config.preflightTestCaseId > 0

    const preflightSection = hasPreflight
      ? `\n## Preflight Gate\n\n- Test Case: ${
          firstRunId
            ? `[#${config.preflightTestCaseId}](${APP_URL}/run-results/${firstRunId}/test/${config.preflightTestCaseId}/overview)`
            : `#${config.preflightTestCaseId}`
        }\n- Result: ${resultEmoji[config.preflightResult || 'Pending'] || 'ℹ️'} ${config.preflightResult || 'Pending'}\n`
      : ''

    const failureSection = failureSections
      ? `\n## ❌ Failed Tests\n\n${failureSections}\n`
      : ''

    const body = `${commentIdentifier}
# [Shiplight](https://app.shiplight.ai) Runner

${preflightSection}
## Test Suites

| Name | Result | Start Time (UTC) | End Time (UTC) |
| :--- | :----- | :------ | :------ |
${tableRows}
${failureSection}
---
_This comment was automatically generated by [Shiplight GitHub Action](https://github.com/marketplace/actions/shiplight-runner)_
`

    const comments = await this.core.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue_number
    })
    const commit = comments.data.find((comment) =>
      comment.body?.startsWith(commentIdentifier)
    )
    if (commit?.id) {
      await this.core.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: commit.id,
        body
      })
    } else {
      await this.core.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issue_number,
        body
      })
    }
  }
}

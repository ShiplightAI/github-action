import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { TestRun, TestCaseResult } from '../client/entity.js'
import { APP_URL } from '../client/constants.js'

const resultEmoji = {
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
  testSuites: Array<{
    testSuiteID: string
    testSuiteName: string
    testSuiteRun: TestRun
    testCaseResults?: TestCaseResult[]
  }>
}

/**
 * Extract failure summary from test case report when summary is null
 */
function extractFailureSummary(testCase: TestCaseResult): string {
  if (testCase.summary) {
    return testCase.summary
  }

  // Try to extract from report
  if (testCase.report && testCase.report.length > 0) {
    const report = testCase.report[0]
    if (report.resultJson) {
      // Find the first failed step
      for (const [stepKey, stepData] of Object.entries(report.resultJson)) {
        if (stepData.status === 'failure' && stepData.message) {
          const stepDesc = stepData.description || stepKey
          // Truncate long messages
          const message =
            stepData.message.length > 150
              ? stepData.message.substring(0, 150) + '...'
              : stepData.message
          return `Step "${stepDesc}": ${message}`
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
    // core.info(`config: ${JSON.stringify(config)}`)

    let issue_number = context.payload.pull_request?.number
    if (!issue_number) {
      if (config.commitSHA) {
        const { data: pull_requests } =
          await this.core.rest.repos.listPullRequestsAssociatedWithCommit({
            owner: context.repo.owner,
            repo: context.repo.repo,
            commit_sha: config.commitSHA
          })

        // core.info(`pull_requests: ${JSON.stringify(pull_requests)}`)

        // Filter for open pull requests
        const openPRs = pull_requests.filter((pr) => pr.state === 'open')
        if (openPRs.length > 0) {
          issue_number = openPRs[0].number
        }
      }
    }

    core.info(`issue_number: ${issue_number}`)

    // ignore if the pull request is not a PR
    if (!issue_number) {
      return
    }

    const commentIdentifier = `<!-- shiplight_tests ${config.identifier} -->`

    // Generate table rows for all test suites
    const tableRows = config.testSuites
      .map((suite) => {
        const testSuiteURL = `${APP_URL}/test-suites/${suite.testSuiteID}`
        const runId = suite.testSuiteRun?.id
        // Simple check: runId exists and is not 0 or empty
        const hasValidRunId = runId && runId !== 0 && String(runId) !== ''

        // Log for debugging
        core.debug(
          `Suite: ${suite.testSuiteName}, runId: ${runId} (type: ${typeof runId}), hasValidRunId: ${hasValidRunId}`
        )

        const name = `[${suite.testSuiteName}](${testSuiteURL})`

        // Build result column with pass/fail counts
        const passedCount = suite.testSuiteRun?.passedTestCaseCount || 0
        const totalCount = suite.testSuiteRun?.totalTestCaseCount || 0

        let result: string
        if (hasValidRunId) {
          const testSuiteRunResultURL = `${APP_URL}/run-results/${runId}`
          const counts =
            totalCount > 0 ? ` (${passedCount}/${totalCount} passed)` : ''
          result = `${resultEmoji[suite.testSuiteRun?.result]} ${suite.testSuiteRun?.result}${counts} [Inspect](${testSuiteRunResultURL})`
        } else {
          // For cases without valid run IDs, don't show inspect link
          const resultText = suite.testSuiteRun?.result || 'Failed'
          result = `${resultEmoji[resultText]} ${resultText}`
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

    // Generate failure details section (after the table)
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
            const testCaseURL = `${APP_URL}/test-case-results/${tc.id}`
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

    const failureSection = failureSections
      ? `\n## ❌ Failed Tests\n\n${failureSections}\n`
      : ''

    const body = `${commentIdentifier}
# [Shiplight](https://app.shiplight.ai) Runner

| Name | Result | Start Time (UTC) | End Time (UTC) |
| :--- | :----- | :------ | :------ |
${tableRows}
${failureSection}
---
_This comment was automatically generated by [Shiplight GitHub Action](https://github.com/marketplace/actions/shiplight-runner)_
`

    // check if the comment already exists
    const comments = await this.core.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue_number
    })
    const commit = comments.data.find((comment) =>
      comment.body?.startsWith(commentIdentifier)
    )
    if (commit?.id) {
      // update the comment
      await this.core.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: commit.id,
        body
      })
    } else {
      // create a new comment
      await this.core.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issue_number,
        body
      })
    }
  }
}

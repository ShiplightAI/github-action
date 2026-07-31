# Shiplight Runner

[![Release](https://img.shields.io/github/v/release/ShiplightAI/github-action)](https://github.com/ShiplightAI/github-action/releases)
[![Continuous Integration](https://github.com/ShiplightAI/github-action/workflows/Continuous%20Integration/badge.svg)](https://github.com/ShiplightAI/github-action/actions)

Run your [Shiplight](https://www.shiplight.ai) end-to-end test suites from
GitHub Actions. The action starts a run, waits for it to finish, posts the
results as a pull request comment, and fails the job when a suite fails.

Shiplight is AI-driven browser testing: tests are authored against your real
application, run in a real browser, and repair themselves when selectors move.
This action is the CI trigger for suites you have already set up.

## Which Shiplight is this for?

This action drives **Shiplight Cloud v1** at
[app.shiplight.ai](https://app.shiplight.ai), where test suites and environments
are configured in the web app and referenced here by ID.

If you are on the current platform at
[nova.shiplight.ai](https://nova.shiplight.ai), where tests live in your
repository and run through the CLI, you do not need this action. See
[Running tests in CI](https://docs.shiplight.ai/local/ci/github-actions.html)
instead.

## Quick start

1. In Shiplight, go to **Settings → API Tokens** and create a token.
1. In your repository, go to **Settings → Secrets and variables → Actions** and
   add it as a secret named `SHIPLIGHT_API_TOKEN`.
1. Note the ID of each test suite you want to run, and the environment ID from
   **Settings → Environments**.
1. Add `.github/workflows/shiplight.yml`:

```yaml
name: Shiplight

on:
  pull_request:
    branches: [main]

# Required so the action can comment on the pull request
permissions:
  contents: read
  pull-requests: write

jobs:
  e2e:
    name: End-to-end tests
    runs-on: ubuntu-latest
    steps:
      - name: Run Shiplight tests
        uses: ShiplightAI/github-action@v2.0.1
        with:
          api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
          test-suite-id: 123
          environment-id: 1
```

No checkout step is needed. The action calls the Shiplight API and never reads
your source.

## What you get on the pull request

The action posts one comment as soon as the run starts and edits that same
comment as the run progresses, so a pull request never collects a trail of
status updates. The comment carries:

- A table of every suite in the run, with its result, pass count, and start and
  end time in UTC
- An **Inspect** link per suite that opens the run in Shiplight
- A collapsed **Failed Tests** section listing each failing test case with the
  step that broke and a link to its trace
- A **Preflight Gate** section, when a preflight test case is configured

Each workflow step gets its own comment, keyed by environment and suite IDs, so
two Shiplight steps in one workflow do not overwrite each other.

## Inputs

| Input                    | Required | Default        | Description                                                                                          |
| ------------------------ | -------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `api-token`              | yes      |                | Shiplight API token. Store it as a repository secret.                                                |
| `test-suite-id`          | yes      |                | Test suite ID, or a comma-separated list (`1` or `1,2,3`). Multiple suites run in parallel.          |
| `environment-id`         | yes      |                | Environment ID the run targets.                                                                      |
| `environment-url`        | no       |                | Override the environment's configured URL. Use this for preview deployments.                         |
| `preflight-test-case-id` | no       |                | Test case to run first as a gate. The main suites run only if it passes.                             |
| `github-comment`         | no       | `true`         | Post and update the pull request comment.                                                            |
| `github-token`           | no       | `GITHUB_TOKEN` | Token used to write the comment.                                                                     |
| `async`                  | no       | `false`        | Start the run and return immediately. The job always succeeds and no comment is posted.              |
| `commit-sha`             | no       |                | Commit used to locate the pull request to comment on. Defaults to the commit that triggered the run. |
| `timeout-seconds`        | no       | `86400`        | How long to wait for the run to finish. The job fails on timeout.                                    |
| `test-context`           | no       |                | Key-value pairs passed into the run, one `KEY=VALUE` per line.                                       |

`preflight-test-case-id` and `test-context` require v2.0.0 or later.

## Outputs

| Output             | Description                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `success`          | `true` when every suite passed                                           |
| `results`          | JSON array of per-suite results (`testSuiteID`, `name`, `result`, `url`) |
| `run-id`           | Shiplight run ID                                                         |
| `run-url`          | Link to the run in Shiplight                                             |
| `preflight-result` | `Passed`, `Failed`, `Skipped`, or `Pending`                              |
| `metadata`         | JSON of the commit, branch, actor, and workflow the run was tagged with  |

The action already fails the job when a suite fails, so you only need these to
do something extra:

```yaml
- name: Run Shiplight tests
  id: shiplight
  uses: ShiplightAI/github-action@v2.0.1
  with:
    api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
    test-suite-id: 1,2
    environment-id: 1

- name: Notify on failure
  if: steps.shiplight.outputs.success == 'false'
  run: echo "Results: ${{ steps.shiplight.outputs.run-url }}"
```

## Common setups

### Test a preview deployment

Point the run at the URL your deploy step produced:

```yaml
- name: Deploy preview
  id: deploy
  run: ./deploy.sh

- name: Run Shiplight tests
  uses: ShiplightAI/github-action@v2.0.1
  with:
    api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
    test-suite-id: 123,456
    environment-id: 1
    environment-url: ${{ steps.deploy.outputs.preview-url }}
    timeout-seconds: 1800
```

### Gate an expensive suite behind one fast test

`preflight-test-case-id` runs a single test case first. If it fails, the main
suites are skipped, which keeps a broken deployment from burning a full run:

```yaml
with:
  api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
  test-suite-id: 123,456
  environment-id: 1
  preflight-test-case-id: 789
```

### Pass build context into the run

```yaml
with:
  api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
  test-suite-id: 123
  environment-id: 1
  test-context: |
    env=${{ vars.DEPLOY_ENV }}
    branch=${{ github.ref_name }}
    build-id=${{ github.run_id }}
```

### Fire and forget

`async: true` starts the run and returns. Nothing is waited on, no comment is
posted, and the job always succeeds. Use it when the run is informational and
you do not want it holding a merge:

```yaml
with:
  api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
  test-suite-id: 123
  environment-id: 1
  async: true
```

## Troubleshooting

**No comment appears on the pull request.** The job needs
`pull-requests: write`, or the broader `permissions: write-all`. Comments are
also skipped when `async: true` is set, and when the workflow was not triggered
by a pull request and no `commit-sha` was given to locate one.

**Authentication failed.** Check that the secret is named exactly
`SHIPLIGHT_API_TOKEN` and that the token is still valid in **Settings → API
Tokens**.

**The run times out.** `timeout-seconds` defaults to 24 hours. Lower it so CI
fails fast, or split a long suite into several that run in parallel by passing
comma-separated IDs.

**A suite ID is rejected.** IDs must be numeric and comma-separated with no
spaces: `1,2,3`, not `1, 2, 3`.

## Documentation

- [GitHub Actions integration guide](https://docs.shiplight.ai/integrations/github-actions.html),
  the full reference including Vercel deployment triggers and test accounts
- [Shiplight documentation](https://docs.shiplight.ai)
- [shiplight.ai](https://www.shiplight.ai)

## License

[MIT](./LICENSE)

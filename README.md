# GitHub Action to Shiplight

![https://github.com/ShiplightAI/github-action](https://img.shields.io/github/v/release/ShiplightAI/github-action)
![https://github.com/ShiplightAI/github-action](https://github.com/ShiplightAI/github-action/workflows/Continuous%20Integration/badge.svg)

## Usage

### Inputs

| option          | required | default        | description                                                                                                                                                          |
| --------------- | -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api-token       | true     |                | API token for Shiplight AI                                                                                                                                           |
| test-suite-id   | true     |                | test suite ID (single ID or comma-separated list, e.g., "suite1" or "suite1,suite2,suite3")                                                                          |
| environment-id  | true     |                | Environment ID                                                                                                                                                       |
| environment-url | false    |                | Environment URL                                                                                                                                                      |
| github-comment  | false    | `true`         | If enabled, the action will comment on the pull request with the test run results                                                                                    |
| github-token    | false    | `GITHUB_TOKEN` | Token used for leaving a comment on the pull request                                                                                                                 |
| async           | false    | `false`        | If enabled, will launch the tests but not wait for them to finish and the action will always output success. Note: GitHub comments will not function if this is set. |

**Note**: The `test-suite-id` parameter supports both single test suite IDs for
backward compatibility and comma-separated lists for running multiple test
suites in parallel. When multiple IDs are provided, all test suites run
simultaneously for improved efficiency.

### Outputs

| output  | description                                        |
| ------- | -------------------------------------------------- |
| success | Whether all test runs were successful              |
| results | JSON string containing results for each test suite |

### Example

```yml
name: Shiplight Test

on:
  pull_request:
    branches:
      - main

# should set permissions to write-all for private repo
permissions: write-all

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - name: Shiplight Test
        uses: ShiplightAI/github-action@v1
        with:
          api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
          test-suite-id: YOUR_SHIPLIGHT_TEST_SUITE_ID # Single ID (backward compatible)
          # test-suite-id: suite1,suite2,suite3        # Multiple IDs (new feature)
          environment-id: YOUR_SHIPLIGHT_ENVIRONMENT_ID
          commit-sha: YOUR_COMMIT_SHA
```

### License

[MIT](./LICENSE)

# GitHub Action to Shiplight

![https://github.com/loggia-AI/github-action](https://img.shields.io/github/v/release/loggia-AI/github-action)
![https://github.com/loggia-AI/github-action](https://github.com/loggia-AI/github-action/workflows/Continuous%20Integration/badge.svg)

## Usage

### Inputs

| option          | required | default        | description                                                                                                                                                          |
| --------------- | -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api-token       | true     |                | API token for Shiplight AI                                                                                                                                           |
| test-suite-id   | true     |                | Test suite ID                                                                                                                                                        |
| environment-id  | false    |                | Environment ID                                                                                                                                                       |
| environment-url | false    |                | Environment URL                                                                                                                                                      |
| github-comment  | false    | `true`         | If enabled, the action will comment on the pull request with the test run results                                                                                    |
| github-token    | false    | `GITHUB_TOKEN` | Token used for leaving a comment on the pull request                                                                                                                 |
| async           | false    | `false`        | If enabled, will launch the tests but not wait for them to finish and the action will always output success. Note: GitHub comments will not function if this is set. |

### Outputs

| output  | description                         |
| ------- | ----------------------------------- |
| success | Whether the test run was successful |

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
        uses: loggia-AI/github-action@v1
        with:
          api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
          test-suite-id: YOUR_SHIPLIGHT_TEST_SUITE_ID
          environment-url: YOUR_SHIPLIGHT_TEST_SUITE_ENVIRONMENT_URL
```

### License

[MIT](./LICENSE)

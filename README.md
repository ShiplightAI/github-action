# GitHub Action to Loggia

![https://github.com/loggia-AI/github-action](https://img.shields.io/github/v/release/loggia-AI/github-action)
![https://github.com/loggia-AI/github-action](https://github.com/loggia-AI/github-action/workflows//Publish/badge.svg)

### Usage

| option                     | required | description                |
| -------------------------- | -------- | -------------------------- |
| api-token                  | true     | api token for loggia-ai    |
| test-suite-id              | true     | test suite id              |
| test-suite-environment-url | true     | test suite environment url |

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
          test-suite-environment-url: YOUR_SHIPLIGHT_TEST_SUITE_ENVIRONMENT_URL
```

### License

[MIT](./LICENSE)

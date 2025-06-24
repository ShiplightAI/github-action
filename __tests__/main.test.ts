/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    // Set the action's inputs as return values from core.getInput().
    core.getInput.mockImplementation(() => '500')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  // it('Sets the url output', async () => {
  //   await run()

  //   // Verify the time output was set.
  //   expect(core.setOutput).toHaveBeenNthCalledWith(
  //     1,
  //     'url',
  //     // Simple regex to match a time string in the format HH:MM:SS.
  //     expect.stringMatching(/^\w+/)
  //   )
  // })

  it('Sets a failed status', async () => {
    // Clear the getInput mock and return an invalid value.
    core.getInput.mockClear().mockReturnValueOnce('this is not a number')

    await run()

    // Verify that the action was marked as failed.
    expect(core.setFailed).toHaveBeenNthCalledWith(1, 'Unauthorized')
  })
})

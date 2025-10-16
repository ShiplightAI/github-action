// APP_URL is the base url for the shiplight app
export const APP_URL =
  process.env.SHIPLIGHT_APP_URL || 'https://app.shiplight.ai'

// API_URL is the base url for the shiplight api server
export const API_URL =
  process.env.SHIPLIGHT_API_URL || 'https://api.shiplight.ai'

// MAX_WAIT_TIME is the maximum time to wait for a test run to finish
export const MAX_WAIT_TIME = 24 * 60 * 60 * 1000 // 24 hours

// POLL_INTERVAL is the interval to poll the test run status
export const POLL_INTERVAL = 10000 // 10 seconds

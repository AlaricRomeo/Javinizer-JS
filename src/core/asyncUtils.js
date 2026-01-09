/**
 * Async Utilities
 *
 * Common utilities for async operations including retry logic,
 * timeout handling, and error management.
 */

/**
 * Retry a function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 2)
 * @param {number} options.baseDelay - Base delay in ms (default: 200)
 * @param {boolean} options.exponential - Use exponential backoff (default: true)
 * @returns {Promise<*>} - Result of the function
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 2,
    baseDelay = 200,
    exponential = true
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }

      // Calculate delay
      const delay = exponential
        ? baseDelay * (attempt + 1)
        : baseDelay;

      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Execute a function with timeout
 *
 * @param {Function} fn - Async function to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} errorMessage - Error message if timeout occurs
 * @returns {Promise<*>} - Result of the function
 */
async function withTimeout(fn, timeoutMs, errorMessage = 'Operation timed out') {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

/**
 * Batch process items with concurrency limit
 *
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to process each item
 * @param {number} concurrency - Maximum concurrent operations
 * @returns {Promise<Array>} - Results array
 */
async function batchProcess(items, fn, concurrency = 5) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const promise = Promise.resolve().then(() => fn(item));
    results.push(promise);

    if (concurrency <= items.length) {
      const e = promise.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

/**
 * Sleep for specified milliseconds
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  retryWithBackoff,
  withTimeout,
  batchProcess,
  sleep
};

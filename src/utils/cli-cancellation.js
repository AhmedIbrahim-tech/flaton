import { logger } from './logger.js';

/**
 * Checks if the given error is a user prompt cancellation (e.g. Ctrl+C in @inquirer/prompts).
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isPromptCancellation(error) {
  if (!error) {
    return false;
  }

  if (typeof error === 'object' && error !== null) {
    const err = /** @type {Error} */ (error);
    const name = err.name;
    if (
      name === 'ExitPromptError' ||
      name === 'CancelPromptError' ||
      name === 'AbortPromptError' ||
      name === 'UserCancellationError'
    ) {
      return true;
    }

    if (
      typeof err.message === 'string' &&
      (err.message.includes('force closed the prompt') ||
        err.message.includes('User force closed') ||
        err.message.includes('Prompt was cancelled'))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Handles Inquirer prompt cancellations centrally.
 * If the error is a prompt cancellation, prints a clean message and sets exitCode to 130.
 *
 * @param {unknown} error
 * @param {string} [message]
 * @returns {boolean} true if the error was handled as a cancellation; false otherwise.
 */
export function handleCliCancellation(error, message = 'Project generation cancelled.') {
  if (isPromptCancellation(error)) {
    logger.warn(message);
    process.exitCode = 130;
    return true;
  }

  return false;
}

import { log } from "./logger.js";

/**
 * Wraps a controller so it no longer needs its own try/catch (BE-I-06).
 *
 * Thirty controllers repeated the same six lines: catch, console.error with a
 * hand-written function name, return a generic 500. That is thirty places to
 * forget the log, thirty chances for the response shape to drift, and thirty
 * copies of a function name that goes stale when the function is renamed.
 *
 * An async function that rejects does not reach Express's error handler on its
 * own — that is the whole reason the pattern existed. This bridges it.
 */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Fire-and-forget work that must not fail the request that triggered it —
 * link previews, push sends, delivery flushes.
 *
 * Named rather than an inline `.catch(() => {})` so these are greppable, and so
 * they always log instead of vanishing.
 */
export const background = (promise, description) => {
  Promise.resolve(promise).catch((error) => {
    log.error({ err: error, task: description }, "background task failed");
  });
};

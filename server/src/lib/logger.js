import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { env_variable } from "./env.js";

/**
 * Structured logging (OBS-01).
 *
 * Replaces 60 `console.*` calls that had no levels, no correlation and no
 * redaction — and three of which logged a user's name and id on every socket
 * connection.
 *
 * `pino` over the alternatives because it is the only one whose overhead is low
 * enough to leave on at info level in production without thinking about it, and
 * because its redaction is declarative: a path list cannot be forgotten at a
 * call site the way a manual `delete` can.
 */

const isTest = env_variable.NODE_ENV === "test";
const isProduction = env_variable.NODE_ENV === "production";

/**
 * Redaction is the part that matters.
 *
 * Everything here is something that grants access if it leaks into a log
 * aggregator: the session cookie, the JWT, a password on its way to bcrypt,
 * push subscription keys (which let anyone send that device a notification),
 * and the Cloudinary signature (which authorises an upload).
 *
 * `censor` rather than `remove` so the *shape* of a log line stays stable and
 * it is obvious a field was present and hidden, not absent.
 */
const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["set-cookie"]',
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "body.password",
  "keys",
  "*.keys",
  "signature",
  "*.signature",
  "endpoint",
  "*.endpoint",
];

export const logger = pino({
  // Silent in tests: 265 tests spraying JSON makes a real failure unfindable.
  level: isTest ? "silent" : env_variable.LOG_LEVEL || (isProduction ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: undefined, // pid and hostname are noise on a single-process deployment
  // JSON in production so an aggregator can parse it; readable locally, where a
  // human is the only consumer.
  transport: isProduction || isTest ? undefined : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});

/**
 * Request-scoped context.
 *
 * AsyncLocalStorage rather than threading a logger parameter through every
 * signature: `lib/*` is called from controllers, sockets and scripts, and
 * adding a logger argument to all of them would be a worse change than the one
 * it enables.
 */
const store = new AsyncLocalStorage();

export const runWithContext = (context, callback) => store.run(context, callback);

export const currentContext = () => store.getStore() ?? {};

/**
 * The logger to use everywhere. Carries the request id automatically when there
 * is one, and nothing when there is not.
 */
export const log = new Proxy(logger, {
  get(target, property) {
    if (["fatal", "error", "warn", "info", "debug", "trace"].includes(property)) {
      const context = currentContext();
      return Object.keys(context).length > 0
        ? target.child(context)[property].bind(target.child(context))
        : target[property].bind(target);
    }
    return Reflect.get(target, property);
  },
});

export const newRequestId = () => randomUUID();

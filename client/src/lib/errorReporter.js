import { axiosInstance } from "./axios";

/**
 * Client error transport (OBS-03).
 *
 * The ErrorBoundary previously console.error'd and dropped it — which is
 * exactly how a temporal-dead-zone crash shipped and was found by a human
 * opening the app rather than by anything automated.
 *
 * Three rules, so that reporting never makes the app worse than the bug it is
 * reporting:
 *   - it is fire-and-forget and never surfaces a failure
 *   - identical errors are sent once per session, not once per occurrence
 *   - it is silent before login, because the endpoint is authenticated
 */
const seen = new Set();
const MAX_PER_SESSION = 10;
let sent = 0;

const fingerprint = (message, stack = "") => `${message}::${stack.split("\n")[1] ?? ""}`;

export const reportError = ({ message, stack, componentStack, kind = "render" }) => {
  if (!message) return;

  const key = fingerprint(message, stack);
  // a render loop throws every frame; the server deduplicates too, but there is
  // no reason to spend the requests
  if (seen.has(key) || sent >= MAX_PER_SESSION) return;

  seen.add(key);
  sent += 1;

  axiosInstance
    .post("/logs/client", {
      message: String(message).slice(0, 500),
      stack: String(stack ?? "").slice(0, 4000),
      componentStack: String(componentStack ?? "").slice(0, 4000),
      // pathname only — search and hash carry conversation ids
      path: window.location.pathname,
      kind,
    })
    .catch(() => {
      // an unreported error is not worth a second error
    });
};

/**
 * Catch what React's boundary cannot: errors outside render, and promises that
 * reject with nobody listening. Both are installed once, from main.jsx.
 */
export const installGlobalErrorHandlers = () => {
  window.addEventListener("error", (event) => {
    reportError({
      message: event.message,
      stack: event.error?.stack,
      kind: "window",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError({
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
      kind: "rejection",
    });
  });
};

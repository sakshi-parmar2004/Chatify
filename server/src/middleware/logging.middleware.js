import { log, runWithContext, newRequestId } from "../lib/logger.js";

/**
 * Establishes the request context and logs the outcome.
 *
 * Deliberately not `pino-http`: it logs on every request at info level, which
 * on a chat app means one line per read-receipt PATCH per keystroke-adjacent
 * action. This logs completions at a level chosen by the status code, so a
 * healthy server is quiet and a broken one is not.
 */
export const requestContext = (req, res, next) => {
  // honour an upstream id if a proxy set one, so a trace survives the hop
  const requestId = req.headers["x-request-id"] || newRequestId();
  res.setHeader("x-request-id", requestId);

  const startedAt = process.hrtime.bigint();

  runWithContext({ requestId }, () => {
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const line = {
        method: req.method,
        // the path pattern, not the URL: /conversations/:id keeps ids out of
        // the message field where they would defeat aggregation
        route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        userId: req.user?._id ? String(req.user._id) : undefined,
      };

      if (res.statusCode >= 500) log.error(line, "request failed");
      else if (res.statusCode >= 400) log.warn(line, "request rejected");
      else log.debug(line, "request");
    });

    next();
  });
};

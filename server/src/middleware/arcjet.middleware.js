import aj from "../lib/arcjet.js";
import { isSpoofedBot } from "@arcjet/inspect";

/**
 * @param {{ failClosed?: boolean }} options
 *   failClosed - reject the request if Arcjet itself errors. Use on credential
 *   and account-creation endpoints, where silently losing rate limiting is
 *   worse than briefly rejecting traffic.
 */
const createArcjetProtection = ({ failClosed = false } = {}) =>
  async (req, res, next) => {
    try {
      const decision = await aj.protect(req);

      if (decision.isDenied()) {
        if (decision.reason.isRateLimit()) {
          return res.status(429).json({ message: "Rate limit exceeded. Please try again later." });
        } else if (decision.reason.isBot()) {
          return res.status(403).json({ message: "Bot access denied." });
        } else {
          return res.status(403).json({
            message: "Access denied by security policy.",
          });
        }
      }

      // check for spoofed bots
      if (decision.results.some(isSpoofedBot)) {
        return res.status(403).json({
          message: "Malicious bot activity detected.",
        });
      }

      next();
    } catch (error) {
      // A bad key, quota exhaustion, or an outage would otherwise disable all
      // protection with nothing but a debug log to show for it.
      console.error("Arcjet protection error:", error.message);

      if (failClosed) {
        return res.status(503).json({ message: "Service temporarily unavailable." });
      }
      next();
    }
  };

export const arcjetProtection = createArcjetProtection();

export const strictArcjetProtection = createArcjetProtection({ failClosed: true });

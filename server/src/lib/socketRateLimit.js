/**
 * Per-socket token bucket.
 *
 * Arcjet guards HTTP only — the socket channel has no rate limiting of any kind.
 * That matters more for inbound events than it looks: a typing indicator is a
 * fan-out amplifier, so one abusive client can turn a held-down key into a
 * broadcast to every participant.
 *
 * Buckets live on the socket itself, so they are garbage collected with it and
 * a client cannot reset its own budget by reconnecting faster than it refills.
 */
const BUCKETS = Symbol("rateLimitBuckets");

/**
 * @param socket   the connected socket
 * @param name     the event being charged
 * @param capacity burst allowance
 * @param perSecond sustained refill rate
 * @returns true when the caller may proceed, false when it is over budget
 */
export const consumeToken = (socket, name, { capacity, perSecond }) => {
  socket[BUCKETS] ??= new Map();

  const now = Date.now();
  const bucket = socket[BUCKETS].get(name) ?? { tokens: capacity, updatedAt: now };

  // refill for the time elapsed, capped at the burst allowance
  const elapsedSeconds = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * perSecond);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    socket[BUCKETS].set(name, bucket);
    return false;
  }

  bucket.tokens -= 1;
  socket[BUCKETS].set(name, bucket);
  return true;
};

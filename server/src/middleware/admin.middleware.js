/**
 * Global admin gate (OBS-04).
 *
 * Per route, never per UI. A client-side guard hides a button; it does not stop
 * a request, and the request is the thing that returns the data.
 *
 * Answers 404 rather than 403, matching loadConversation: a 403 confirms the
 * route exists and that admins exist, which is free reconnaissance.
 */
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(404).json({ message: "Not found." });
  }
  next();
};

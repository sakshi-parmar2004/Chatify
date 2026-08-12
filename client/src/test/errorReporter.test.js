import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/axios", () => ({
  axiosInstance: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const { axiosInstance } = await import("../lib/axios");

/** The module dedupes per session, so each test needs a fresh copy. */
const freshReporter = async () => {
  vi.resetModules();
  return import("../lib/errorReporter");
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OBS-03 — client error transport", () => {
  it("posts a render crash", async () => {
    const { reportError } = await freshReporter();

    reportError({ message: "Boom", stack: "Error\n  at Thing (a.jsx:1)", kind: "render" });

    expect(axiosInstance.post).toHaveBeenCalledWith(
      "/logs/client",
      expect.objectContaining({ message: "Boom", kind: "render" })
    );
  });

  it("sends an identical error once per session", async () => {
    const { reportError } = await freshReporter();
    const payload = { message: "Boom", stack: "Error\n  at Thing (a.jsx:1)" };

    // a render loop throws every frame; the server dedupes too, but there is no
    // reason to spend the requests
    reportError(payload);
    reportError(payload);
    reportError(payload);

    expect(axiosInstance.post).toHaveBeenCalledTimes(1);
  });

  it("treats different errors as different", async () => {
    const { reportError } = await freshReporter();

    reportError({ message: "One", stack: "Error\n  at A (a.jsx:1)" });
    reportError({ message: "Two", stack: "Error\n  at B (b.jsx:1)" });

    expect(axiosInstance.post).toHaveBeenCalledTimes(2);
  });

  it("caps how many it will send in one session", async () => {
    const { reportError } = await freshReporter();

    for (let i = 0; i < 40; i += 1) {
      reportError({ message: `Boom ${i}`, stack: `Error\n  at A${i} (a.jsx:1)` });
    }

    expect(axiosInstance.post.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("sends the pathname only — search and hash carry ids", async () => {
    const { reportError } = await freshReporter();

    window.history.replaceState({}, "", "/?conversation=abc#token=xyz");
    reportError({ message: "Boom" });

    const [, body] = axiosInstance.post.mock.calls[0];
    expect(body.path).toBe("/");
  });

  it("truncates an oversized payload before sending it", async () => {
    const { reportError } = await freshReporter();

    reportError({ message: "x".repeat(5000), stack: "y".repeat(20000) });

    const [, body] = axiosInstance.post.mock.calls[0];
    expect(body.message.length).toBeLessThanOrEqual(500);
    expect(body.stack.length).toBeLessThanOrEqual(4000);
  });

  it("ignores an empty message", async () => {
    const { reportError } = await freshReporter();
    reportError({ message: "" });
    expect(axiosInstance.post).not.toHaveBeenCalled();
  });

  it("never throws when the report itself fails", async () => {
    const { reportError } = await freshReporter();
    axiosInstance.post.mockRejectedValueOnce(new Error("offline"));

    // an unreported error is not worth a second error
    expect(() => reportError({ message: "Boom" })).not.toThrow();
  });
});

describe("global handlers", () => {
  it("reports an unhandled rejection", async () => {
    const { installGlobalErrorHandlers } = await freshReporter();
    installGlobalErrorHandlers();

    const event = new Event("unhandledrejection");
    event.reason = new Error("promise blew up");
    window.dispatchEvent(event);

    expect(axiosInstance.post).toHaveBeenCalledWith(
      "/logs/client",
      expect.objectContaining({ message: "promise blew up", kind: "rejection" })
    );
  });

  it("reports a window error", async () => {
    const { installGlobalErrorHandlers } = await freshReporter();
    installGlobalErrorHandlers();

    const event = new Event("error");
    event.message = "script blew up";
    event.error = new Error("script blew up");
    window.dispatchEvent(event);

    expect(axiosInstance.post).toHaveBeenCalledWith(
      "/logs/client",
      expect.objectContaining({ kind: "window" })
    );
  });
});

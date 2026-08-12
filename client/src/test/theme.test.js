import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/axios", () => ({
  axiosInstance: { put: vi.fn().mockResolvedValue({ data: {} }), get: vi.fn(), post: vi.fn() },
}));

const { useThemeStore } = await import("../store/useThemeStore");
const { axiosInstance } = await import("../lib/axios");
const { DEFAULT_THEME } = await import("../lib/themes");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  delete document.documentElement.dataset.transparency;
  useThemeStore.setState({ theme: DEFAULT_THEME, reduceTransparency: false, wallpaper: null });
});

describe("UIX-03 — theme store", () => {
  it("writes the theme to the document", () => {
    useThemeStore.getState().setTheme("ember");
    expect(document.documentElement.dataset.theme).toBe("ember");
  });

  it("sets color-scheme so the browser's own surfaces follow", () => {
    useThemeStore.getState().setTheme("daylight");
    expect(document.documentElement.style.colorScheme).toBe("light");

    useThemeStore.getState().setTheme("abyss");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("caches to localStorage so the next cold load does not flash", () => {
    useThemeStore.getState().setTheme("aurora");
    expect(localStorage.getItem("chatify-theme")).toBe("aurora");
  });

  it("persists to the account", () => {
    useThemeStore.getState().setTheme("parchment");
    expect(axiosInstance.put).toHaveBeenCalledWith("/preferences", { theme: "parchment" });
  });

  it("ignores an unknown theme entirely", () => {
    useThemeStore.getState().setTheme("vaporwave");

    expect(useThemeStore.getState().theme).toBe(DEFAULT_THEME);
    expect(axiosInstance.put).not.toHaveBeenCalled();
  });

  it("applies the theme even when the save fails", async () => {
    axiosInstance.put.mockRejectedValueOnce(new Error("offline"));

    useThemeStore.getState().setTheme("ember");

    // a theme switch that waits for a round trip feels broken; a lost write is
    // recoverable, a laggy UI is not
    expect(document.documentElement.dataset.theme).toBe("ember");
    await Promise.resolve();
  });
});

describe("reduce transparency", () => {
  it("marks the document and clears it again", () => {
    useThemeStore.getState().setReduceTransparency(true);
    expect(document.documentElement.dataset.transparency).toBe("reduce");

    useThemeStore.getState().setReduceTransparency(false);
    expect(document.documentElement.dataset.transparency).toBeUndefined();
  });

  it("survives a theme change", () => {
    useThemeStore.getState().setReduceTransparency(true);
    useThemeStore.getState().setTheme("aurora");

    expect(document.documentElement.dataset.transparency).toBe("reduce");
  });
});

describe("account reconciliation", () => {
  it("takes the account's theme over the cached one", () => {
    useThemeStore.getState().setTheme("ember");
    vi.clearAllMocks();

    // a theme chosen on another device should follow the user here
    useThemeStore.getState().syncFromAccount({
      preferences: { theme: "daylight", reduceTransparency: true },
    });

    expect(useThemeStore.getState().theme).toBe("daylight");
    expect(document.documentElement.dataset.theme).toBe("daylight");
    expect(localStorage.getItem("chatify-theme")).toBe("daylight");
    // reconciling must not echo straight back to the server
    expect(axiosInstance.put).not.toHaveBeenCalled();
  });

  it("keeps the local theme when the account has none", () => {
    useThemeStore.getState().setTheme("aurora");
    useThemeStore.getState().syncFromAccount({ preferences: {} });

    expect(useThemeStore.getState().theme).toBe("aurora");
  });

  it("ignores a user with no preferences at all", () => {
    useThemeStore.getState().setTheme("aurora");
    useThemeStore.getState().syncFromAccount({});

    expect(useThemeStore.getState().theme).toBe("aurora");
  });

  it("picks up the account wallpaper", () => {
    useThemeStore.getState().syncFromAccount({
      preferences: { theme: "midnight", wallpaper: { preset: "mesh", url: null } },
    });

    expect(useThemeStore.getState().wallpaper).toEqual({ preset: "mesh", url: null });
  });
});

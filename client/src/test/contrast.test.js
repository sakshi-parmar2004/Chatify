import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { THEME_IDS } from "../lib/themes";

/**
 * The one visual property worth testing.
 *
 * A redesign cannot be regression-tested by asserting class names — that just
 * pins the implementation. Contrast is different: it is the property that
 * actually breaks when someone tweaks a palette, it is objectively measurable,
 * and on a glassmorphism UI it is the thing most likely to quietly degrade.
 *
 * Parsed straight from the stylesheet so the test cannot drift from what ships.
 */
// resolved from the workspace root: under Vite's transform `import.meta.url`
// is an http URL, not a file one
const css = readFileSync(resolve(process.cwd(), "src/styles/themes.css"), "utf8");

/** Pull one theme's `--token: r g b;` declarations out of its block. */
const tokensFor = (themeId) => {
  const selector =
    themeId === "midnight" ? ":root,\n[data-theme=\"midnight\"]" : `[data-theme="${themeId}"]`;
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No block for theme "${themeId}"`);

  const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens = {};

  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const channels = value.trim().split(/\s+/).map(Number);
    if (channels.length === 3 && channels.every((n) => Number.isFinite(n))) {
      tokens[name] = channels;
    } else {
      tokens[name] = value.trim();
    }
  }
  return tokens;
};

/** WCAG relative luminance. */
const luminance = ([r, g, b]) => {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** What a translucent surface actually composites to over the page background. */
const over = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

describe.each(THEME_IDS)("theme: %s", (themeId) => {
  const t = tokensFor(themeId);
  const opacity = Number(t["glass-opacity"]);
  // the composite a glass panel actually produces, not the raw surface token
  const glass = over(t.surface, t.bg, opacity);
  const glassRaised = over(t["surface-raised"], t.bg, Math.min(opacity + 0.25, 1));

  it("defines every required token", () => {
    for (const name of [
      "bg", "surface", "surface-raised", "line", "accent", "accent-soft",
      "accent-ink", "text", "text-muted", "text-faint", "danger", "success",
    ]) {
      expect(t[name], `--${name} missing from ${themeId}`).toHaveLength(3);
    }
  });

  it("body text clears AA on a glass surface", () => {
    expect(contrast(t.text, glass)).toBeGreaterThanOrEqual(4.5);
  });

  it("secondary text clears AA", () => {
    expect(contrast(t["text-muted"], glass)).toBeGreaterThanOrEqual(4.5);
  });

  it("meta text clears AA-large", () => {
    // timestamps and counts — small but never the only copy on screen
    expect(contrast(t["text-faint"], glass)).toBeGreaterThanOrEqual(3);
  });

  it("text on a raised surface clears AA", () => {
    expect(contrast(t.text, glassRaised)).toBeGreaterThanOrEqual(4.5);
  });

  it("own-message text clears AA against the accent bubble", () => {
    // the accent-ink token exists precisely so this holds on light themes,
    // where white-on-accent fails
    expect(contrast(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("the accent is distinguishable as a link or control", () => {
    expect(contrast(t["accent-soft"], glass)).toBeGreaterThanOrEqual(3);
  });

  it("destructive actions are legible", () => {
    expect(contrast(t.danger, glass)).toBeGreaterThanOrEqual(3);
  });

  it("body text survives the wallpaper scrim at its worst case", () => {
    // The scrim sits between an arbitrary image and the messages. Worst case is
    // a pure-white photo on a dark theme (or pure black on a light one): the
    // scrim has to hold contrast on its own, because the image is unknowable.
    const scrim = Number(t.scrim);
    const worstImage = luminance(t.bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
    const scrimmed = over(t.bg, worstImage, scrim);
    const bubble = over(t["surface-raised"], scrimmed, Math.max(opacity, 0.82));

    expect(contrast(t.text, bubble)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("theme registry", () => {
  it("every registered theme has a stylesheet block", () => {
    for (const id of THEME_IDS) {
      expect(() => tokensFor(id)).not.toThrow();
    }
  });

  it("the stylesheet defines no themes the registry does not know about", () => {
    const declared = [...css.matchAll(/\[data-theme="([\w-]+)"\]/g)].map((m) => m[1]);
    expect([...new Set(declared)].sort()).toEqual([...THEME_IDS].sort());
  });
});

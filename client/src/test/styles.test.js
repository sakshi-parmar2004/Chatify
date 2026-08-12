import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Guards against a class that no longer exists.
 *
 * Neither the build nor the linter can catch this: `className` is just a
 * string, Tailwind does not error on an unknown class, and a missing component
 * class renders as *nothing* rather than as a failure. Deleting `.auth-input-icon`
 * from index.css left the login form's mail and lock icons floating above the
 * fields instead of sitting inside them, and everything still compiled, linted
 * and passed 174 tests.
 *
 * So: every class we define ourselves must exist where it is used. Tailwind's
 * own utilities are out of scope — they are Tailwind's problem, and enumerating
 * them here would be a second source of truth.
 */
const root = process.cwd();
const css = readFileSync(resolve(root, "src/index.css"), "utf8");

/** Class names defined in index.css, from `.foo {` at the start of a line. */
const defined = new Set(
  [...css.matchAll(/^\s*\.([a-z][\w-]*)\s*[,{]/gm)].map((match) => match[1])
);

/**
 * The prefixes this project owns. A class in JSX matching one of these but not
 * defined above is a dangling reference; anything else is assumed to be
 * Tailwind's.
 */
const OWNED = /^(glass|field|icon-btn|btn|pill|wallpaper|bubble|auth)(-|$)/;

const sourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return /\.jsx?$/.test(entry.name) ? [path] : [];
  });

const usages = [];
for (const file of sourceFiles(resolve(root, "src"))) {
  const source = readFileSync(file, "utf8");
  for (const [, value] of source.matchAll(/className\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    for (const name of value.split(/\s+/)) {
      // skip template holes and Tailwind's arbitrary-value syntax
      if (!name || name.includes("$") || name.includes("[")) continue;
      if (OWNED.test(name)) usages.push({ name, file: file.replace(`${root}/`, "") });
    }
  }
}

describe("component classes", () => {
  it("finds usages to check", () => {
    // if this ever hits zero the regex has rotted and the suite is vacuous
    expect(usages.length).toBeGreaterThan(10);
  });

  it("defines every project class that JSX references", () => {
    const dangling = usages.filter((usage) => !defined.has(usage.name));

    expect(
      dangling.map((usage) => `${usage.name} (${usage.file})`),
      "these classes are used but not defined in src/index.css"
    ).toEqual([]);
  });

  it("still defines the primitives the components are built from", () => {
    for (const name of [
      "glass", "glass-raised", "glass-plain",
      "field", "field-icon", "icon-btn",
      "btn-primary", "btn-ghost", "pill",
      "wallpaper-layer", "wallpaper-scrim", "bubble-floor",
    ]) {
      expect(defined.has(name), `.${name} is missing from index.css`).toBe(true);
    }
  });

  it("has no leftover raw palette classes outside the token definitions", () => {
    const offenders = [];

    for (const file of sourceFiles(resolve(root, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const [, match] of source.matchAll(/className\s*=\s*["'`]([^"'`]+)["'`]/g)) {
        // the whole point of UIX-01: colour comes from tokens, never from a
        // hardcoded Tailwind palette step
        if (/\b(slate|cyan|rose|sky|pink|zinc|indigo|emerald|amber)-\d{2,3}\b/.test(match)) {
          offenders.push(`${file.replace(`${root}/`, "")}: ${match.slice(0, 60)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

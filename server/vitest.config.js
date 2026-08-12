import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Dummy credentials are set before any import so that lib/env.js — which
    // calls dotenv.config() and exits on a missing key — never falls through to
    // the real .env. dotenv does not overwrite variables that are already set,
    // so a stray credential cannot reach a test.
    setupFiles: ["./src/test/env.js"],
    globalSetup: ["./src/test/globalSetup.js"],
    // Mongoose models are global to the process, so parallel files sharing one
    // in-memory database would race on collection state.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});

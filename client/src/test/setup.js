import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// Node 25 ships its own `localStorage` global, which shadows jsdom's and throws
// on getItem. useChatStore reads it at module scope, so this has to be in place
// before the store is imported.
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  },
});

// jsdom implements neither of these, and the components use both: Audio for the
// notification sound, scrollTo/scrollIntoView for pinning the message list.
globalThis.Audio = class {
  play() {
    return Promise.resolve();
  }
  pause() {}
};
Element.prototype.scrollIntoView = vi.fn();

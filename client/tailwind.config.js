/**
 * daisyUI was removed here (DEC-13).
 *
 * Its whole footprint was three components, two of which were already fully
 * overridden inline. It was also an active bug: with no `themes` key it emits a
 * light `:root` and swaps only under `prefers-color-scheme`, so a light-mode OS
 * rendered the chat-bubble tail, the tab base and the presence dot light inside
 * an unconditionally dark app.
 *
 * Colours resolve from CSS custom properties so a theme can be swapped at
 * runtime by changing one attribute on <html>. The channel-triplet form is what
 * keeps Tailwind's opacity modifiers (`bg-surface/60`) working.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--surface-raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          ink: "rgb(var(--accent-ink) / <alpha-value>)",
        },
        ink: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--text-muted) / <alpha-value>)",
        faint: "rgb(var(--text-faint) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        "glow-a": "rgb(var(--glow-a) / <alpha-value>)",
        "glow-b": "rgb(var(--glow-b) / <alpha-value>)",
      },
      animation: {
        border: "border 4s linear infinite",
      },
      keyframes: {
        border: { to: { "--border-angle": "360deg" } },
      },
    },
  },
  plugins: [],
};

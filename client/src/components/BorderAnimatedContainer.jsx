/**
 * The animated gradient card that frames both the auth pages and the chat shell.
 *
 * Rewritten for UIX-01/UIX-02. Two things had to change:
 *
 *   1. It used `theme(colors.*)`, which Tailwind resolves at build time — so
 *      the border could never follow a runtime theme.
 *   2. Its `padding-box` fill was opaque, which meant children with
 *      `backdrop-blur` had nothing to blur through. Glass inside an opaque box
 *      is just a flat panel.
 *
 * Now the fill is translucent and every colour comes from a custom property, so
 * the card follows the theme and actually lets the backdrop show through.
 */
function BorderAnimatedContainer({ children }) {
  return (
    <div
      className="animate-border flex h-full w-full overflow-hidden rounded-none border border-transparent sm:rounded-2xl"
      style={{
        background: [
          // the card fill — translucent so the page backdrop reads through it
          "linear-gradient(135deg, rgb(var(--surface) / 0.55), rgb(var(--surface-raised) / 0.35)) padding-box",
          // the rotating border, drawn in the border ring only
          [
            "conic-gradient(from var(--border-angle),",
            "rgb(var(--line) / 0.28) 78%,",
            "rgb(var(--accent) / 0.9) 86%,",
            "rgb(var(--accent-soft)) 90%,",
            "rgb(var(--accent) / 0.9) 94%,",
            "rgb(var(--line) / 0.28))",
          ].join(" ") + " border-box",
        ].join(", "),
        backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
        WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
      }}
    >
      {children}
    </div>
  );
}

export default BorderAnimatedContainer;

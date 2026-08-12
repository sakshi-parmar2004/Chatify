/**
 * The icon affordance, previously `text-slate-400 hover:text-ink
 * transition-colors` repeated in 18+ places.
 *
 * `label` is required rather than optional — every one of those call sites was
 * an icon with no accessible name until an audit added them one at a time.
 */
function IconButton({ label, icon: Icon, onClick, tone = "default", className = "", ...rest }) {
  const tones = {
    default: "",
    accent: "text-accent-soft",
    danger: "hover:text-danger",
  };

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`icon-btn ${tones[tone]} ${className}`}
      {...rest}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

export default IconButton;

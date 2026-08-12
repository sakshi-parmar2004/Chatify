// Varied widths and alternating sides, because a column of identical bars reads
// as a broken layout rather than as loading. Mirrors MessageBubble's real
// geometry so the swap-in does not shift the page.
const ROWS = [
  { mine: false, width: "w-40" },
  { mine: true, width: "w-28" },
  { mine: false, width: "w-56" },
  { mine: true, width: "w-44" },
  { mine: false, width: "w-32" },
  { mine: true, width: "w-52" },
];

function MessagesLoadingSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {ROWS.map((row, index) => (
        <div
          key={index}
          className={`flex animate-pulse ${row.mine ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`h-10 rounded-2xl ${row.width} ${
              row.mine ? "rounded-br-md bg-accent/25" : "rounded-bl-md bg-raised/60"
            }`}
          />
        </div>
      ))}
      <span className="sr-only">Loading messages</span>
    </div>
  );
}
export default MessagesLoadingSkeleton;

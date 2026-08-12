// Matches the real row's geometry — padding, radius and avatar size — so the
// list does not jump when the data lands. The old version used a different
// background from the rows it stood in for.
function UsersLoadingSkeleton() {
  return (
    <div className="space-y-1.5">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="animate-pulse rounded-xl p-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-line/15" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-3/5 rounded bg-line/15" />
              <div className="h-2.5 w-2/5 rounded bg-line/10" />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Loading conversations</span>
    </div>
  );
}
export default UsersLoadingSkeleton;
